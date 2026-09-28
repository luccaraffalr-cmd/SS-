-- Tareas 10, 11 y 12: asignación de viajes (automática con aceptación, y manual).
-- Se ejecuta una sola vez en Supabase → SQL Editor.
--
-- Estados del viaje:
--   sin_chofer  → esperando (o "espera_gestion" si un chofer rechazó una asignación manual)
--   ofrecido    → se le ofreció a un chofer y todavía no aceptó
--                 (automático: tiene 3 minutos; manual: sin límite)
--   asignado    → el chofer aceptó. Cuando toca "Salir a hacer el viaje", queda "iniciado".
--   pago_pendiente / finalizado / fallido / anulado
--
-- Reglas decididas con el dueño (28/9/2026):
--   * Oferta automática: 3 min para aceptar. Si no contesta, el viaje pasa al siguiente y él
--     conserva su lugar. Si rechaza, el viaje pasa al siguiente y él sale de la cola (queda libre).
--   * Asignación manual: el chofer acepta al recibirla (sin tiempo) y después toca
--     "Salir a hacer el viaje". Si la rechaza, el viaje vuelve a gestión (no se asigna solo).
--   * Prioridad entre viajes esperando: primero los "priorizados" (⭐), después los programados,
--     después los inmediatos; dentro de cada grupo, el de hora de asignación más temprana.
--   * Un chofer con un programado asignado sigue en la cola (puede rechazar ofertas).

alter table public.viajes drop constraint viajes_estado_check;
alter table public.viajes add constraint viajes_estado_check
  check (estado in ('sin_chofer', 'ofrecido', 'asignado', 'pago_pendiente', 'finalizado', 'fallido', 'anulado'));

alter table public.viajes
  add column prioritario    boolean not null default false,
  add column espera_gestion boolean not null default false,  -- rechazado a mano: decide gestión
  add column rechazado_por  uuid references public.perfiles (id),
  add column asignado_en    timestamptz,
  add column asignado_por   uuid references public.perfiles (id),  -- vacío = oferta automática
  add column oferta_vence   timestamptz,                           -- vacío = sin límite (manual)
  add column aceptado_en    timestamptz,
  add column iniciado_en    timestamptz,                           -- "Salir a hacer el viaje"
  add column anulado_en     timestamptz,
  add column anulado_por    uuid references public.perfiles (id);

-- Historial de ofertas: a quién se le ofreció cada viaje y qué respondió.
create table public.ofertas (
  id            bigint generated always as identity primary key,
  viaje_id      bigint not null references public.viajes (id) on delete cascade,
  chofer_id     uuid not null references public.perfiles (id) on delete cascade,
  tipo          text not null check (tipo in ('automatica', 'manual')),
  creada_en     timestamptz not null default now(),
  vence         timestamptz,
  resultado     text not null default 'pendiente'
    check (resultado in ('pendiente', 'aceptada', 'rechazada', 'vencida', 'cancelada')),
  respondida_en timestamptz
);
create index ofertas_viaje on public.ofertas (viaje_id);

alter table public.ofertas enable row level security;
create policy "ver ofertas" on public.ofertas
  for select to authenticated
  using (chofer_id = auth.uid() or public.mi_rol() in ('admin', 'operador'));

-- Cierra la oferta pendiente de un viaje con un resultado.
create or replace function public.cerrar_oferta(p_viaje bigint, p_resultado text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ofertas set resultado = p_resultado, respondida_en = now()
  where viaje_id = p_viaje and resultado = 'pendiente';
$$;
revoke execute on function public.cerrar_oferta(bigint, text) from public, anon, authenticated;

---------------------------------------------------------------------------
-- El corazón. Se llama cada vez que algo puede generar una oferta
-- (se carga o libera un viaje, un chofer entra a la cola, cada minuto, y desde las apps).
--   1) Vence las ofertas automáticas que pasaron los 3 minutos (el chofer conserva su lugar).
--   2) Ofrece cada viaje esperando al primero de la cola que esté disponible.
-- Es atómica: nunca dos ofertas al mismo chofer ni dos choferes para el mismo viaje.
---------------------------------------------------------------------------
create or replace function public.asignar_pendientes()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_chofer uuid;
begin
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));
  -- Evita que el disparador de viajes vuelva a llamar a esta función mientras trabaja.
  perform set_config('app.asignando', '1', true);

  -- 1) Ofertas automáticas vencidas → el viaje vuelve a esperar.
  for v in
    select id from public.viajes
    where estado = 'ofrecido' and oferta_vence is not null and oferta_vence < now()
    for update
  loop
    perform public.cerrar_oferta(v.id, 'vencida');
    update public.viajes
    set estado = 'sin_chofer', chofer_id = null, oferta_vence = null, asignado_en = null
    where id = v.id;
  end loop;

  -- 2) Viajes esperando, en orden de prioridad → primer chofer disponible de la cola.
  for v in
    select id from public.viajes
    where estado = 'sin_chofer' and not espera_gestion and hora_asignacion <= now()
    order by prioritario desc, (tipo = 'programado') desc, hora_asignacion, id
    for update
  loop
    select c.id into v_chofer
    from public.choferes c
    where c.estado = 'en_cola' and not c.oculto
      -- no tiene otra oferta automática esperando respuesta
      and not exists (select 1 from public.viajes o
                      where o.chofer_id = c.id and o.estado = 'ofrecido' and o.oferta_vence is not null)
      -- no le llegó la hora de un viaje que ya aceptó (tiene que salir a hacerlo)
      and not exists (select 1 from public.viajes a
                      where a.chofer_id = c.id and a.estado = 'asignado'
                        and a.iniciado_en is null and a.hora_asignacion <= now())
      -- no se lo ofrecieron antes (lo rechazó o no contestó)
      and not exists (select 1 from public.ofertas f where f.viaje_id = v.id and f.chofer_id = c.id)
    order by c.anunciado_en
    limit 1
    for update of c;

    continue when not found;

    update public.viajes
    set estado = 'ofrecido', chofer_id = v_chofer, asignado_en = now(), asignado_por = null,
        oferta_vence = now() + interval '3 minutes'
    where id = v.id;

    insert into public.ofertas (viaje_id, chofer_id, tipo, vence)
    values (v.id, v_chofer, 'automatica', now() + interval '3 minutes');
  end loop;

  perform set_config('app.asignando', '', true);
end;
$$;
revoke execute on function public.asignar_pendientes() from public, anon, authenticated;

-- Las apps (gestión y choferes) también pueden pedir una revisión, para que las ofertas
-- vencidas pasen al siguiente sin esperar al minuto del servidor.
create or replace function public.revisar_asignaciones()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.mi_rol() is null then raise exception 'No permitido'; end if;
  perform public.asignar_pendientes();
end;
$$;

-- Cuando un viaje queda esperando (se carga, se libera, se prioriza…), se revisan las ofertas.
create or replace function public.viaje_intentar_asignar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'sin_chofer' and coalesce(current_setting('app.asignando', true), '') <> '1' then
    perform public.asignar_pendientes();
  end if;
  return null;
end;
$$;

create trigger viajes_intentar_asignar
  after insert or update of estado, chofer_id, hora_asignacion, prioritario, espera_gestion on public.viajes
  for each row execute function public.viaje_intentar_asignar();

-- Cuando un chofer entra a la cola, si hay viajes esperando se le ofrece uno en el momento.
create or replace function public.poner_en_cola(chofer uuid)
returns public.choferes
language plpgsql
security definer
set search_path = public
as $$
declare
  fila public.choferes;
begin
  select * into fila from public.choferes where id = chofer for update;
  if not found then raise exception 'Chofer no encontrado'; end if;
  if fila.oculto then raise exception 'Los choferes ocultos no entran en la cola.'; end if;
  if fila.estado = 'en_viaje' then raise exception 'Tiene un viaje sin finalizar.'; end if;

  if fila.estado <> 'en_cola' then
    update public.choferes
    set estado = 'en_cola', estado_desde = now(), anunciado_en = clock_timestamp()
    where id = chofer;
    perform public.asignar_pendientes();
  end if;

  select * into fila from public.choferes where id = chofer;
  return fila;
end;
$$;
revoke execute on function public.poner_en_cola(uuid) from public, anon, authenticated;

-- Respaldo en el servidor: cada minuto (programados que llegan a su hora, ofertas vencidas).
select cron.schedule('asignar-pendientes', '* * * * *', 'select public.asignar_pendientes()');

---------------------------------------------------------------------------
-- Respuestas del chofer.
---------------------------------------------------------------------------

-- Pasa al chofer a "en viaje" con ese viaje (sale de la cola).
create or replace function public.iniciar_viaje_interno(p_viaje bigint, p_chofer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.viajes
             where chofer_id = p_chofer and estado = 'asignado' and iniciado_en is not null and id <> p_viaje) then
    raise exception 'Primero finalizá el viaje que estás haciendo.';
  end if;
  update public.viajes set iniciado_en = now() where id = p_viaje;
  update public.choferes
  set estado = 'en_viaje', estado_desde = now(), anunciado_en = null, ultimo_reporte = now()
  where id = p_chofer;
end;
$$;
revoke execute on function public.iniciar_viaje_interno(bigint, uuid) from public, anon, authenticated;

-- Aceptar. Oferta automática: sale a hacerlo en el momento. Manual: queda aceptado.
create or replace function public.aceptar_viaje(viaje bigint)
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
  if not found or v.estado <> 'ofrecido' or v.chofer_id is distinct from auth.uid() then
    raise exception 'Este viaje ya no está disponible para vos.';
  end if;
  if v.oferta_vence is not null and v.oferta_vence < now() then
    raise exception 'Se terminó el tiempo para aceptar este viaje.';
  end if;

  perform public.cerrar_oferta(viaje, 'aceptada');
  update public.viajes
  set estado = 'asignado', aceptado_en = now(), oferta_vence = null
  where id = viaje;
  update public.choferes set ultimo_reporte = now() where id = auth.uid();

  if v.oferta_vence is not null then
    perform public.iniciar_viaje_interno(viaje, auth.uid());
  end if;
end;
$$;

-- Rechazar. Automática: el viaje pasa al siguiente y el chofer sale de la cola.
-- Manual: el viaje vuelve a gestión.
create or replace function public.rechazar_viaje(viaje bigint)
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
  if not found or v.estado <> 'ofrecido' or v.chofer_id is distinct from auth.uid() then
    raise exception 'Este viaje ya no está disponible para vos.';
  end if;

  perform public.cerrar_oferta(viaje, 'rechazada');

  if v.oferta_vence is not null then
    update public.choferes
    set estado = 'libre', estado_desde = now(), anunciado_en = null, ultimo_reporte = now()
    where id = auth.uid() and estado = 'en_cola';
    update public.viajes
    set estado = 'sin_chofer', chofer_id = null, oferta_vence = null, asignado_en = null,
        rechazado_por = auth.uid()
    where id = viaje;  -- el disparador lo ofrece al siguiente
  else
    update public.choferes set ultimo_reporte = now() where id = auth.uid();
    update public.viajes
    set estado = 'sin_chofer', chofer_id = null, asignado_en = null, asignado_por = null,
        espera_gestion = true, rechazado_por = auth.uid()
    where id = viaje;
  end if;
end;
$$;

-- "Salir a hacer el viaje" (viajes asignados a mano, cuando le llega la hora o termina el anterior).
create or replace function public.salir_a_hacer_viaje(viaje bigint)
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
  if not found or v.estado <> 'asignado' or v.chofer_id is distinct from auth.uid() or v.iniciado_en is not null then
    raise exception 'Este viaje ya no está disponible para vos.';
  end if;

  perform public.iniciar_viaje_interno(viaje, auth.uid());
  perform public.asignar_pendientes();
end;
$$;

---------------------------------------------------------------------------
-- Gestión.
---------------------------------------------------------------------------

-- Deja a un chofer que perdió el viaje que ya estaba haciendo (anulado o reasignado):
-- vuelve al puesto 1 de la cola (los ocultos quedan libres).
create or replace function public.devolver_chofer_a_la_cola(chofer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  primero timestamptz;
begin
  if exists (select 1 from public.viajes
             where chofer_id = chofer and estado = 'asignado' and iniciado_en is not null) then
    return;
  end if;

  select min(anunciado_en) into primero from public.choferes where estado = 'en_cola';

  update public.choferes
  set estado = case when oculto then 'libre' else 'en_cola' end,
      anunciado_en = case when oculto then null
                          else coalesce(primero - interval '1 second', clock_timestamp()) end,
      estado_desde = now()
  where id = chofer and estado = 'en_viaje';
end;
$$;
revoke execute on function public.devolver_chofer_a_la_cola(uuid) from public, anon, authenticated;

-- Asignación manual. chofer = null → deja el viaje sin chofer y vuelve a la asignación automática.
create or replace function public.asignar_viaje(viaje bigint, chofer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'Solo para gestión'; end if;
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));

  select * into v from public.viajes where id = viaje for update;
  if not found then raise exception 'Viaje no encontrado'; end if;
  if v.estado not in ('sin_chofer', 'ofrecido', 'asignado') then raise exception 'Este viaje ya terminó.'; end if;
  if chofer is not null and not exists (
    select 1 from public.perfiles where id = chofer and rol = 'chofer' and activo) then
    raise exception 'Ese chofer no existe o está desactivado.';
  end if;

  perform public.cerrar_oferta(viaje, 'cancelada');

  if chofer is null then
    update public.viajes
    set estado = 'sin_chofer', chofer_id = null, asignado_en = null, asignado_por = null,
        oferta_vence = null, aceptado_en = null, iniciado_en = null, espera_gestion = false
    where id = viaje;
  else
    update public.viajes
    set estado = 'ofrecido', chofer_id = chofer, asignado_en = now(), asignado_por = auth.uid(),
        oferta_vence = null, aceptado_en = null, iniciado_en = null, espera_gestion = false
    where id = viaje;
    insert into public.ofertas (viaje_id, chofer_id, tipo) values (viaje, chofer, 'manual');
  end if;

  -- Si el chofer anterior ya lo estaba haciendo, vuelve al puesto 1.
  if v.iniciado_en is not null and v.chofer_id is not null then
    perform public.devolver_chofer_a_la_cola(v.chofer_id);
  end if;

  perform public.asignar_pendientes();
end;
$$;

-- Anular un viaje. Si el chofer ya lo estaba haciendo, vuelve al puesto 1.
create or replace function public.anular_viaje(viaje bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'Solo para gestión'; end if;
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));

  select * into v from public.viajes where id = viaje for update;
  if not found then raise exception 'Viaje no encontrado'; end if;
  if v.estado not in ('sin_chofer', 'ofrecido', 'asignado') then
    raise exception 'Este viaje ya terminó; no se puede anular.';
  end if;

  perform public.cerrar_oferta(viaje, 'cancelada');
  update public.viajes
  set estado = 'anulado', anulado_en = now(), anulado_por = auth.uid(), oferta_vence = null
  where id = viaje;

  if v.iniciado_en is not null and v.chofer_id is not null then
    perform public.devolver_chofer_a_la_cola(v.chofer_id);
  end if;
  perform public.asignar_pendientes();  -- el chofer liberado puede recibir otro viaje
end;
$$;

---------------------------------------------------------------------------
-- El chofer ve sus propios viajes.
---------------------------------------------------------------------------
create policy "chofer ve sus viajes" on public.viajes
  for select to authenticated
  using (public.mi_rol() = 'chofer' and chofer_id = auth.uid());

alter publication supabase_realtime add table public.ofertas;
