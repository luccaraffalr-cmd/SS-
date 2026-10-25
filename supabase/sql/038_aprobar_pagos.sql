-- Aprobar los pagos (pedido del dueño, 24/10/2026): en la lista de viajes, los finalizados tienen un tick a la derecha;
-- se tickean uno o varios y se confirma con la burbuja verde de abajo → quedan "✅ Aprobado".
--   - Solo los admins aprueban (y quitan la aprobación, desde adentro del viaje, con confirmación).
--   - Si el pago cambia (lo corrige gestión, lo vuelve a cargar el chofer) o el viaje deja de estar finalizado, deja de
--     estar aprobado y hay que volver a aprobarlo.
--   - No es un estado nuevo: el viaje sigue "finalizado" (así la planilla y las cuentas siguen igual) y se anota quién y
--     cuándo lo aprobó. En la pantalla se ve como "Aprobado".
-- Se ejecuta una sola vez en Supabase → SQL Editor.

alter table public.viajes
  add column aprobado_en  timestamptz,
  add column aprobado_por uuid references public.perfiles (id);

-- Cuida la aprobación: solo la cambian aprobar_pagos y quitar_aprobacion, y se pierde si cambia el pago.
create or replace function public.viajes_cuidar_aprobacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.aprobando', true), '') <> '1' then
    if tg_op = 'INSERT' then
      new.aprobado_en := null;
      new.aprobado_por := null;
      return new;
    end if;
    new.aprobado_en := old.aprobado_en;
    new.aprobado_por := old.aprobado_por;
  end if;

  if tg_op = 'UPDATE' and old.aprobado_en is not null and new.aprobado_en is not null
     and ((new.importe, new.forma_pago, new.cuenta_id, new.cuenta_otro, new.demora, new.peaje, new.nafta, new.pago_cargado_en)
          is distinct from
          (old.importe, old.forma_pago, old.cuenta_id, old.cuenta_otro, old.demora, old.peaje, old.nafta, old.pago_cargado_en)
          or new.estado <> 'finalizado') then
    new.aprobado_en := null;
    new.aprobado_por := null;
    perform public.registrar(new.id, 'Se quitó la aprobación del pago (cambió el pago): hay que volver a aprobarlo');
  end if;
  return new;
end;
$$;

create trigger viajes_cuidar_aprobacion
  before insert or update on public.viajes
  for each row execute function public.viajes_cuidar_aprobacion();

-- Aprobar varios pagos de una vez (los que ya estaban aprobados o no están finalizados se saltean).
create or replace function public.aprobar_pagos(p_viajes bigint[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  aprobado bigint;
  cuantos integer := 0;
begin
  if public.mi_rol() is distinct from 'admin' then raise exception 'Solo los administradores aprueban pagos.'; end if;
  perform set_config('app.aprobando', '1', true);
  for aprobado in
    update public.viajes set aprobado_en = now(), aprobado_por = auth.uid()
    where id = any (p_viajes) and estado = 'finalizado' and aprobado_en is null
    returning id
  loop
    perform public.registrar(aprobado, 'Pago aprobado');
    cuantos := cuantos + 1;
  end loop;
  perform set_config('app.aprobando', '', true);
  return cuantos;
end;
$$;
revoke execute on function public.aprobar_pagos(bigint[]) from public, anon;

-- Quitar la aprobación (desde adentro del viaje, por si se aprobó uno por error).
create or replace function public.quitar_aprobacion(p_viaje bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.mi_rol() is distinct from 'admin' then raise exception 'Solo los administradores quitan la aprobación.'; end if;
  perform set_config('app.aprobando', '1', true);
  update public.viajes set aprobado_en = null, aprobado_por = null where id = p_viaje and aprobado_en is not null;
  if found then perform public.registrar(p_viaje, 'Se quitó la aprobación del pago'); end if;
  perform set_config('app.aprobando', '', true);
end;
$$;
revoke execute on function public.quitar_aprobacion(bigint) from public, anon;
