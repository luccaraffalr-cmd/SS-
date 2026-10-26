-- Destino al terminar el viaje (pedido del dueño, 26/10/2026): si el viaje se cargó sin destino, el chofer lo escribe
-- cuando carga el pago ("¿A dónde lo llevaste?"). Así queda en la app y en la planilla.
-- finalizar_viaje y cargar_pago (025) reciben el destino (opcional: la pantalla vieja no lo manda) y lo guardan solo si
-- el viaje no tenía. Igual que en 025, más eso.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

drop function public.finalizar_viaje(bigint, text, numeric, text, text, bigint, text, numeric, numeric, numeric);
drop function public.cargar_pago(bigint, numeric, text, bigint, text, numeric, numeric, numeric);

-- Guarda el destino que escribió el chofer, si el viaje no tenía.
create or replace function public.completar_destino(p_viaje bigint, p_destino text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.viajes set destino = trim(p_destino)
  where id = p_viaje and destino is null and nullif(trim(p_destino), '') is not null
$$;
revoke execute on function public.completar_destino(bigint, text) from public, anon, authenticated;

create or replace function public.finalizar_viaje(viaje bigint, opcion text,
  importe numeric default null, forma_pago text default null, motivo text default null, cuenta bigint default null,
  otro text default null, demora numeric default null, peaje numeric default null, nafta numeric default null,
  destino text default null)
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
    perform public.completar_destino(viaje, finalizar_viaje.destino);  -- antes del pago, así va a la planilla
    perform public.guardar_pago(viaje, importe, forma_pago, cuenta, otro, demora, peaje, nafta);
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

create or replace function public.cargar_pago(viaje bigint, importe numeric, forma_pago text, cuenta bigint default null,
  otro text default null, demora numeric default null, peaje numeric default null, nafta numeric default null,
  destino text default null)
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
  perform public.completar_destino(viaje, cargar_pago.destino);  -- antes del pago, así va a la planilla
  perform public.guardar_pago(viaje, importe, forma_pago, cuenta, otro, demora, peaje, nafta);
  update public.choferes set ultimo_reporte = now() where id = auth.uid();
end;
$$;
