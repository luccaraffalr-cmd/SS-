-- Tareas 10, 11 y 12: asignación automática y manual.
--   * Automática (reglas A, B y E), también para los programados cuando llega su hora.
--   * Manual (reglas C y D): gestión asigna, cambia o deja sin chofer cualquier viaje,
--     incluso a un chofer que está en viaje (queda como su "próximo viaje").
--   * Anular viaje: el chofer vuelve al puesto 1 de la cola.
--   * El chofer ve sus viajes.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

alter table public.viajes
  add column asignado_en  timestamptz,
  add column asignado_por uuid references public.perfiles (id),  -- vacío = lo asignó el sistema
  add column anulado_en   timestamptz,
  add column anulado_por  uuid references public.perfiles (id);

---------------------------------------------------------------------------
-- El corazón. Se llama cada vez que algo puede generar una asignación
-- (se carga o libera un viaje, un chofer entra a la cola, y cada minuto).
--   1) Si un chofer tiene un viaje asignado cuya hora ya llegó, pasa a "en viaje"
--      (y sale de la cola). Así funcionan los programados con chofer elegido.
--   2) Los viajes asignables sin chofer van a los primeros de la cola,
--      primero el de hora de asignación más temprana.
-- Es atómica: nunca dos viajes al mismo chofer ni dos choferes al mismo viaje.
---------------------------------------------------------------------------
create or replace function public.asignar_pendientes()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_viaje  bigint;
  v_chofer uuid;
begin
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));

  -- 1) Choferes con un viaje asignado cuya hora ya llegó → en viaje.
  update public.choferes c
  set estado = 'en_viaje', estado_desde = now(), anunciado_en = null
  where c.estado <> 'en_viaje'
    and exists (select 1 from public.viajes v
                where v.chofer_id = c.id and v.estado = 'asignado' and v.hora_asignacion <= now());

  -- 2) Viajes esperando → primeros de la cola.
  loop
    select id into v_viaje
    from public.viajes
    where estado = 'sin_chofer' and chofer_id is null and hora_asignacion <= now()
    order by hora_asignacion, id
    limit 1
    for update;
    exit when not found;

    select id into v_chofer
    from public.choferes
    where estado = 'en_cola' and not oculto
    order by anunciado_en
    limit 1
    for update;
    exit when not found;

    update public.viajes
    set estado = 'asignado', chofer_id = v_chofer, asignado_en = now(), asignado_por = null
    where id = v_viaje;

    -- Regla E: al recibir un viaje, sale de la cola.
    update public.choferes
    set estado = 'en_viaje', estado_desde = now(), anunciado_en = null
    where id = v_chofer;
  end loop;
end;
$$;
revoke execute on function public.asignar_pendientes() from public, anon, authenticated;

-- Deja a un chofer que perdió su viaje (anulado o reasignado).
-- Si todavía tiene otro viaje en curso, sigue en viaje. Si no, vuelve al puesto 1
-- de la cola (los ocultos no van a la cola: quedan libres).
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
             where chofer_id = chofer and estado = 'asignado' and hora_asignacion <= now()) then
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

-- Regla A: cada vez que se carga o cambia un viaje, se revisan las asignaciones.
create or replace function public.viaje_intentar_asignar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado in ('sin_chofer', 'asignado') then
    perform public.asignar_pendientes();
  end if;
  return null;
end;
$$;

create trigger viajes_intentar_asignar
  after insert or update of estado, chofer_id, hora_asignacion on public.viajes
  for each row execute function public.viaje_intentar_asignar();

-- Regla B: cuando un chofer entra a la cola, si hay viajes esperando se le asigna uno en el momento.
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

-- Programados: cada minuto, en el servidor, se asignan los que llegaron a su hora.
select cron.schedule('asignar-pendientes', '* * * * *', 'select public.asignar_pendientes()');

---------------------------------------------------------------------------
-- Asignación manual (reglas C y D). chofer = null → deja el viaje sin chofer
-- (pasa a ser un viaje común y entra en la asignación automática).
---------------------------------------------------------------------------
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
  if v.estado not in ('sin_chofer', 'asignado') then raise exception 'Este viaje ya terminó.'; end if;
  if chofer is not null and not exists (
    select 1 from public.perfiles where id = chofer and rol = 'chofer' and activo) then
    raise exception 'Ese chofer no existe o está desactivado.';
  end if;
  if chofer is not distinct from v.chofer_id then return; end if;

  if chofer is null then
    update public.viajes
    set estado = 'sin_chofer', chofer_id = null, asignado_en = null, asignado_por = null
    where id = viaje;
  else
    update public.viajes
    set estado = 'asignado', chofer_id = chofer, asignado_en = now(), asignado_por = auth.uid()
    where id = viaje;
  end if;

  -- El chofer que lo tenía antes, si ya estaba haciéndolo, vuelve al puesto 1.
  if v.chofer_id is not null then
    perform public.devolver_chofer_a_la_cola(v.chofer_id);
  end if;

  perform public.asignar_pendientes();
end;
$$;

---------------------------------------------------------------------------
-- Anular un viaje (gestión). Si el chofer ya lo estaba haciendo, vuelve al puesto 1.
---------------------------------------------------------------------------
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
  if v.estado not in ('sin_chofer', 'asignado') then raise exception 'Este viaje ya terminó; no se puede anular.'; end if;

  update public.viajes
  set estado = 'anulado', anulado_en = now(), anulado_por = auth.uid()
  where id = viaje;

  if v.chofer_id is not null then
    perform public.devolver_chofer_a_la_cola(v.chofer_id);
    perform public.asignar_pendientes();  -- puede que haya otro viaje esperando para él
  end if;
end;
$$;

---------------------------------------------------------------------------
-- El chofer ve sus propios viajes (con los datos del cliente).
---------------------------------------------------------------------------
create policy "chofer ve sus viajes" on public.viajes
  for select to authenticated
  using (public.mi_rol() = 'chofer' and chofer_id = auth.uid());
