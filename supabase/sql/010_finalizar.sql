-- Tarea 14: finalizar el viaje, cargar el pago y corregirlo desde gestión.
-- Se ejecuta una sola vez en Supabase → SQL Editor.
--
-- El chofer toca "Finalicé" y elige:
--   1) Cargar pago  → finalizado (queda libre; se tiene que anunciar de nuevo)
--   2) Cargar después → pago_pendiente (queda libre; lo carga después desde "Mis viajes sin pago")
--   3) Fallido      → fallido, motivo opcional (vuelve al puesto 1 de la cola; decidido 28/9/2026)

alter table public.viajes
  add column finalizado_en       timestamptz,
  add column importe             numeric(12, 2) check (importe is null or importe >= 0),
  add column forma_pago          text check (forma_pago is null or forma_pago in
                                   ('efectivo', 'transferencia_chofer', 'transferencia_duenio', 'cuenta_corriente')),
  add column comision_porcentaje numeric(5, 2),  -- % del chofer vigente al cargar el pago (no cambia después)
  add column pago_cargado_en     timestamptz,
  add column pago_cargado_por    uuid references public.perfiles (id),
  add column motivo_fallido      text;

-- Registro de cada carga o corrección de pago.
create table public.cambios_pago (
  id            bigint generated always as identity primary key,
  viaje_id      bigint not null references public.viajes (id) on delete cascade,
  hecho_por     uuid references public.perfiles (id) default auth.uid(),
  hecho_en      timestamptz not null default now(),
  importe_antes numeric(12, 2),
  forma_antes   text,
  importe_nuevo numeric(12, 2),
  forma_nueva   text
);
alter table public.cambios_pago enable row level security;
create policy "gestion ve cambios de pago" on public.cambios_pago
  for select to authenticated using (public.mi_rol() in ('admin', 'operador'));

-- Guarda importe y forma de pago, con registro. Uso interno.
create or replace function public.guardar_pago(p_viaje bigint, p_importe numeric, p_forma text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
begin
  if p_importe is null or p_importe < 0 then raise exception 'Falta el importe.'; end if;
  if p_forma not in ('efectivo', 'transferencia_chofer', 'transferencia_duenio', 'cuenta_corriente') then
    raise exception 'Falta la forma de pago.';
  end if;

  select * into v from public.viajes where id = p_viaje for update;

  insert into public.cambios_pago (viaje_id, importe_antes, forma_antes, importe_nuevo, forma_nueva)
  values (p_viaje, v.importe, v.forma_pago, p_importe, p_forma);

  update public.viajes
  set importe = p_importe, forma_pago = p_forma, estado = 'finalizado',
      pago_cargado_en = now(), pago_cargado_por = auth.uid(),
      comision_porcentaje = coalesce(v.comision_porcentaje,
        (select porcentaje from public.comisiones where chofer_id = v.chofer_id), 20)
  where id = p_viaje;
end;
$$;
revoke execute on function public.guardar_pago(bigint, numeric, text) from public, anon, authenticated;

-- El chofer termina el viaje que está haciendo.
-- opcion: 'pago' (con importe y forma), 'despues' o 'fallido' (con motivo opcional).
create or replace function public.finalizar_viaje(viaje bigint, opcion text,
  importe numeric default null, forma_pago text default null, motivo text default null)
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
    perform public.guardar_pago(viaje, importe, forma_pago);
  elsif opcion = 'despues' then
    update public.viajes set estado = 'pago_pendiente' where id = viaje;
  else
    update public.viajes set estado = 'fallido', motivo_fallido = nullif(trim(motivo), '') where id = viaje;
  end if;

  update public.choferes set ultimo_reporte = now() where id = auth.uid();

  if opcion = 'fallido' then
    -- Vuelve al puesto 1 de la cola (los ocultos quedan libres).
    perform public.devolver_chofer_a_la_cola(auth.uid());
    perform public.asignar_pendientes();
  else
    -- Queda libre: para volver a la cola se tiene que anunciar.
    update public.choferes
    set estado = 'libre', estado_desde = now(), anunciado_en = null
    where id = auth.uid() and estado = 'en_viaje';
  end if;
end;
$$;

-- El chofer carga el pago de un viaje que dejó "para después".
create or replace function public.cargar_pago(viaje bigint, importe numeric, forma_pago text)
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
  perform public.guardar_pago(viaje, importe, forma_pago);
  update public.choferes set ultimo_reporte = now() where id = auth.uid();
end;
$$;

-- Gestión carga o corrige el importe y la forma de pago de un viaje hecho (queda registrado).
create or replace function public.corregir_pago(viaje bigint, importe numeric, forma_pago text)
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
  perform public.guardar_pago(viaje, importe, forma_pago);
end;
$$;
