-- Cuentas corrientes (clientes y empresas): a quién se le carga un viaje pagado "a cuenta".
-- Por ahora solo la lista y a qué cuenta va cada viaje. Saldos y pagos: Etapa 3.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

create table public.cuentas_corrientes (
  id        bigint generated always as identity primary key,
  nombre    text not null unique,
  tipo      text not null default 'empresa' check (tipo in ('cliente', 'empresa')),
  telefono  text,
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);

alter table public.cuentas_corrientes enable row level security;

-- Todos los usuarios ven la lista (el chofer la necesita para elegir). Solo el admin la maneja.
create policy "ver cuentas corrientes" on public.cuentas_corrientes
  for select to authenticated using (public.mi_rol() is not null);

create policy "admin gestiona cuentas corrientes" on public.cuentas_corrientes
  for all to authenticated
  using (public.mi_rol() = 'admin')
  with check (public.mi_rol() = 'admin');

-- A qué cuenta va el viaje: una de la lista, u "Otro" con el nombre escrito a mano.
alter table public.viajes
  add column cuenta_id   bigint references public.cuentas_corrientes (id),
  add column cuenta_otro text;
alter table public.cambios_pago
  add column cuenta_antes      bigint references public.cuentas_corrientes (id),
  add column cuenta_nueva      bigint references public.cuentas_corrientes (id),
  add column cuenta_otro_antes text,
  add column cuenta_otro_nueva text;

-- Las funciones de pago ahora reciben también la cuenta (obligatoria si es cuenta corriente).
drop function public.finalizar_viaje(bigint, text, numeric, text, text);
drop function public.cargar_pago(bigint, numeric, text);
drop function public.corregir_pago(bigint, numeric, text);
drop function public.guardar_pago(bigint, numeric, text);

create or replace function public.guardar_pago(p_viaje bigint, p_importe numeric, p_forma text,
  p_cuenta bigint, p_cuenta_otro text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
  v_cuenta bigint := case when p_forma = 'cuenta_corriente' then p_cuenta end;
  v_otro text := case when p_forma = 'cuenta_corriente' and p_cuenta is null then nullif(trim(p_cuenta_otro), '') end;
begin
  if p_importe is null or p_importe < 0 then raise exception 'Falta el importe.'; end if;
  if p_forma not in ('efectivo', 'transferencia_chofer', 'transferencia_duenio', 'cuenta_corriente') then
    raise exception 'Falta la forma de pago.';
  end if;
  if p_forma = 'cuenta_corriente' and v_otro is null and not exists (
    select 1 from public.cuentas_corrientes where id = v_cuenta and activo) then
    raise exception 'Elegí a qué cuenta corriente se carga el viaje (o escribí el nombre en "Otro").';
  end if;

  select * into v from public.viajes where id = p_viaje for update;

  insert into public.cambios_pago (viaje_id, importe_antes, forma_antes, cuenta_antes, cuenta_otro_antes,
                                   importe_nuevo, forma_nueva, cuenta_nueva, cuenta_otro_nueva)
  values (p_viaje, v.importe, v.forma_pago, v.cuenta_id, v.cuenta_otro,
          p_importe, p_forma, v_cuenta, v_otro);

  update public.viajes
  set importe = p_importe, forma_pago = p_forma, cuenta_id = v_cuenta, cuenta_otro = v_otro, estado = 'finalizado',
      pago_cargado_en = now(), pago_cargado_por = auth.uid(),
      comision_porcentaje = coalesce(v.comision_porcentaje,
        (select porcentaje from public.comisiones where chofer_id = v.chofer_id), 20)
  where id = p_viaje;
end;
$$;
revoke execute on function public.guardar_pago(bigint, numeric, text, bigint, text) from public, anon, authenticated;

create or replace function public.finalizar_viaje(viaje bigint, opcion text,
  importe numeric default null, forma_pago text default null, motivo text default null, cuenta bigint default null, otro text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
begin
  if public.mi_rol() is distinct from 'chofer' then raise exception 'Solo para choferes'; end if;
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));

  select * into v from public.viajes where id = viaje for update;
  if not found or v.chofer_id is distinct from auth.uid() or v.estado <> 'asignado' or v.iniciado_en is null then
    raise exception 'Este viaje no está en curso.';
  end if;
  if opcion not in ('pago', 'despues', 'fallido') then raise exception 'Opción no válida'; end if;

  update public.viajes set finalizado_en = now() where id = viaje;

  if opcion = 'pago' then
    perform public.guardar_pago(viaje, importe, forma_pago, cuenta, otro);
  elsif opcion = 'despues' then
    update public.viajes set estado = 'pago_pendiente' where id = viaje;
  else
    update public.viajes set estado = 'fallido', motivo_fallido = nullif(trim(motivo), '') where id = viaje;
  end if;

  update public.choferes set ultimo_reporte = now() where id = auth.uid();

  if opcion = 'fallido' then
    perform public.devolver_chofer_a_la_cola(auth.uid());
    perform public.asignar_pendientes();
  else
    update public.choferes
    set estado = 'libre', estado_desde = now(), anunciado_en = null
    where id = auth.uid() and estado = 'en_viaje';
  end if;
end;
$$;

create or replace function public.cargar_pago(viaje bigint, importe numeric, forma_pago text, cuenta bigint default null, otro text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
begin
  if public.mi_rol() is distinct from 'chofer' then raise exception 'Solo para choferes'; end if;
  select * into v from public.viajes where id = viaje for update;
  if not found or v.chofer_id is distinct from auth.uid() or v.estado <> 'pago_pendiente' then
    raise exception 'Este viaje no tiene el pago pendiente.';
  end if;
  perform public.guardar_pago(viaje, importe, forma_pago, cuenta, otro);
  update public.choferes set ultimo_reporte = now() where id = auth.uid();
end;
$$;

create or replace function public.corregir_pago(viaje bigint, importe numeric, forma_pago text, cuenta bigint default null, otro text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'Solo para gestión'; end if;
  select * into v from public.viajes where id = viaje for update;
  if not found or v.estado not in ('pago_pendiente', 'finalizado') then
    raise exception 'Solo se puede cargar el pago de un viaje hecho.';
  end if;
  perform public.guardar_pago(viaje, importe, forma_pago, cuenta, otro);
end;
$$;
