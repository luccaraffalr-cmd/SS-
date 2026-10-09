-- Etapa 3, parte 1 (decidido el 9/10/2026): la app reemplaza al formulario de Google de los choferes.
-- Cuando se carga (o se corrige) el pago de un viaje, la función "planilla" escribe la misma fila que el formulario
-- en la planilla de la remisería (hoja "Respuestas de formulario 1"). La planilla sigue siendo la principal para la plata.
--   1) Demora, peaje y nafta en el pago, como en el formulario. En la planilla la comisión es sobre importe + demora
--      (el peaje no paga comisión).
--   2) "Nombre en la planilla" en la ficha del chofer (vacío = el nombre del usuario).
--   3) Viajes para pasar a la planilla: se piden al cargar o corregir el pago (o si gestión cambia cliente, origen,
--      destino u horario de un viaje finalizado) y se reintentan solos cada 5 minutos si algo falla.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

---------------------------------------------------------------------------
-- 1) Demora, peaje y nafta.
---------------------------------------------------------------------------

alter table public.viajes
  add column demora numeric(12, 2) check (demora is null or demora >= 0),  -- se cobra aparte y paga comisión
  add column peaje  numeric(12, 2) check (peaje is null or peaje >= 0),    -- se cobra aparte, sin comisión
  add column nafta  numeric(12, 2) check (nafta is null or nafta >= 0);    -- lo que cargó el chofer (gasto)

alter table public.cambios_pago
  add column demora_antes numeric(12, 2), add column demora_nueva numeric(12, 2),
  add column peaje_antes  numeric(12, 2), add column peaje_nuevo  numeric(12, 2),
  add column nafta_antes  numeric(12, 2), add column nafta_nueva  numeric(12, 2);

drop function public.finalizar_viaje(bigint, text, numeric, text, text, bigint, text);
drop function public.cargar_pago(bigint, numeric, text, bigint, text);
drop function public.corregir_pago(bigint, numeric, text, bigint, text);
drop function public.guardar_pago(bigint, numeric, text, bigint, text);

create or replace function public.guardar_pago(p_viaje bigint, p_importe numeric, p_forma text,
  p_cuenta bigint, p_cuenta_otro text, p_demora numeric, p_peaje numeric, p_nafta numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
  v_cuenta bigint := case when p_forma = 'cuenta_corriente' then p_cuenta end;
  v_otro text := case when p_forma = 'cuenta_corriente' and p_cuenta is null then nullif(trim(p_cuenta_otro), '') end;
  -- 0 o vacío = no hubo (en la planilla queda en blanco, como en el formulario)
  v_demora numeric := nullif(p_demora, 0);
  v_peaje numeric := nullif(p_peaje, 0);
  v_nafta numeric := nullif(p_nafta, 0);
begin
  if p_importe is null or p_importe < 0 then raise exception 'Falta el importe.'; end if;
  if v_demora < 0 or v_peaje < 0 or v_nafta < 0 then raise exception 'Demora, peaje y nafta no pueden ser negativos.'; end if;
  if p_forma not in ('efectivo', 'transferencia_chofer', 'transferencia_duenio', 'cuenta_corriente') then
    raise exception 'Falta la forma de pago.';
  end if;
  if p_forma = 'cuenta_corriente' and v_otro is null and not exists (
    select 1 from public.cuentas_corrientes where id = v_cuenta and activo) then
    raise exception 'Elegí a qué cuenta corriente se carga el viaje (o escribí el nombre en "Otro").';
  end if;

  select * into v from public.viajes where id = p_viaje for update;

  insert into public.cambios_pago (viaje_id, importe_antes, forma_antes, cuenta_antes, cuenta_otro_antes,
                                   demora_antes, peaje_antes, nafta_antes,
                                   importe_nuevo, forma_nueva, cuenta_nueva, cuenta_otro_nueva,
                                   demora_nueva, peaje_nuevo, nafta_nueva)
  values (p_viaje, v.importe, v.forma_pago, v.cuenta_id, v.cuenta_otro, v.demora, v.peaje, v.nafta,
          p_importe, p_forma, v_cuenta, v_otro, v_demora, v_peaje, v_nafta);

  update public.viajes
  set importe = p_importe, forma_pago = p_forma, cuenta_id = v_cuenta, cuenta_otro = v_otro,
      demora = v_demora, peaje = v_peaje, nafta = v_nafta, estado = 'finalizado',
      pago_cargado_en = now(), pago_cargado_por = auth.uid(),
      comision_porcentaje = coalesce(v.comision_porcentaje,
        (select porcentaje from public.comisiones where chofer_id = v.chofer_id), 20)
  where id = p_viaje;
end;
$$;
revoke execute on function public.guardar_pago(bigint, numeric, text, bigint, text, numeric, numeric, numeric)
  from public, anon, authenticated;

create or replace function public.finalizar_viaje(viaje bigint, opcion text,
  importe numeric default null, forma_pago text default null, motivo text default null, cuenta bigint default null,
  otro text default null, demora numeric default null, peaje numeric default null, nafta numeric default null)
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
  otro text default null, demora numeric default null, peaje numeric default null, nafta numeric default null)
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
  perform public.guardar_pago(viaje, importe, forma_pago, cuenta, otro, demora, peaje, nafta);
  update public.choferes set ultimo_reporte = now() where id = auth.uid();
end;
$$;

create or replace function public.corregir_pago(viaje bigint, importe numeric, forma_pago text, cuenta bigint default null,
  otro text default null, demora numeric default null, peaje numeric default null, nafta numeric default null)
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
  perform public.guardar_pago(viaje, importe, forma_pago, cuenta, otro, demora, peaje, nafta);
end;
$$;

---------------------------------------------------------------------------
-- 2) Nombre del chofer en la planilla (tal cual aparece en la columna "Chofer" y en su hoja).
---------------------------------------------------------------------------

alter table public.choferes add column nombre_planilla text;

---------------------------------------------------------------------------
-- 3) Viajes para pasar a la planilla.
---------------------------------------------------------------------------

create table public.planilla_envios (
  viaje_id   bigint primary key references public.viajes (id) on delete cascade,
  pendiente  boolean not null default true,      -- hay que escribirlo (o corregirlo) en la planilla
  pedido_en  timestamptz not null default now(), -- última vez que se pidió (carga o corrección)
  tomado_en  timestamptz,                        -- la función lo está escribiendo (evita filas repetidas)
  intentos   integer not null default 0,
  error      text,                               -- último error (para que gestión lo vea)
  enviado_en timestamptz,
  fila       integer,                            -- fila de la planilla donde quedó
  planilla   text                                -- en qué planilla se escribió (la de prueba o la de verdad)
);
alter table public.planilla_envios enable row level security;
create policy "gestion ve los envios a la planilla" on public.planilla_envios
  for select to authenticated using (public.mi_rol() in ('admin', 'operador'));

-- Le pide a la función "planilla" que escriba lo pendiente.
create or replace function public.avisar_a_la_planilla()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://yomjqdbaatydpvazkvvg.supabase.co/functions/v1/planilla',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvbWpxZGJhYXR5ZHB2YXprdnZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MDAzODUsImV4cCI6MjEwNjE3NjM4NX0.7qNU5RVjZ-am6wg5qXf9J85wikDHstVemt8fJaoOca4'
    ),
    body := '{}'::jsonb
  );
end;
$$;
revoke execute on function public.avisar_a_la_planilla() from public, anon, authenticated;

-- Al cargar o corregir el pago (o cambiar los datos que van a la planilla de un viaje ya finalizado).
create or replace function public.viajes_a_la_planilla()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'finalizado' and (
       new.pago_cargado_en is distinct from old.pago_cargado_en
    or new.cliente_nombre is distinct from old.cliente_nombre
    or new.origen is distinct from old.origen
    or new.destino is distinct from old.destino
    or new.hora_presentacion is distinct from old.hora_presentacion) then
    insert into public.planilla_envios (viaje_id) values (new.id)
    on conflict (viaje_id) do update set pendiente = true, pedido_en = now(), intentos = 0, error = null;
    perform public.avisar_a_la_planilla();
  end if;
  return null;
end;
$$;

create trigger viajes_a_la_planilla
  after update on public.viajes
  for each row execute function public.viajes_a_la_planilla();

-- Para la función: toma los pendientes (de a uno por vez cada viaje, para no escribir filas repetidas).
create or replace function public.tomar_envios_planilla(p_limite integer default 20)
returns setof public.planilla_envios
language sql
security definer
set search_path = public
as $$
  update public.planilla_envios e set tomado_en = now()
  where e.viaje_id in (
    select viaje_id from public.planilla_envios
    where pendiente and intentos < 30 and (tomado_en is null or tomado_en < now() - interval '3 minutes')
    order by pedido_en
    limit p_limite
    for update skip locked)
  returning e.*;
$$;
revoke execute on function public.tomar_envios_planilla(integer) from public, anon, authenticated;

-- Cada 5 minutos: si quedó algo sin pasar (Google no respondió, etc.), se vuelve a intentar.
-- Después de 30 intentos (unas 2 horas y media) deja de intentar y gestión ve el error.
create or replace function public.reintentar_planilla()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.planilla_envios
             where pendiente and intentos < 30 and (tomado_en is null or tomado_en < now() - interval '3 minutes')) then
    perform public.avisar_a_la_planilla();
  end if;
end;
$$;
revoke execute on function public.reintentar_planilla() from public, anon, authenticated;

select cron.schedule('planilla-reintentos', '*/5 * * * *', 'select public.reintentar_planilla()');

-- Botón "Volver a intentar" en gestión (después de arreglar lo que fallaba).
create or replace function public.reintentar_envio_planilla(viaje bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'Solo para gestión'; end if;
  update public.planilla_envios
  set pendiente = true, pedido_en = now(), intentos = 0, error = null
  where viaje_id = viaje;
  perform public.avisar_a_la_planilla();
end;
$$;
