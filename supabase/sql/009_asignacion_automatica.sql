-- Tareas 10 y 11: asignación automática (reglas A, B y E) y programados a su hora.
-- También: anular viaje (el chofer vuelve al puesto 1) y que el chofer vea su viaje.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

alter table public.viajes
  add column asignado_en  timestamptz,
  add column asignado_por uuid references public.perfiles (id),  -- vacío = asignación automática
  add column anulado_en   timestamptz,
  add column anulado_por  uuid references public.perfiles (id);

---------------------------------------------------------------------------
-- El corazón: asigna los viajes asignables sin chofer a los primeros de la cola.
-- Se llama cada vez que algo puede generar una asignación:
--   * se carga o se libera un viaje (regla A)
--   * un chofer entra a la cola (regla B)
--   * cada minuto, para los programados que llegan a su hora
-- Orden: primero el viaje con la hora de asignación más temprana.
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
  -- Una sola asignación a la vez en toda la app.
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));

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

-- Regla A: al cargar o liberar un viaje que ya es asignable, se intenta asignar.
create or replace function public.viaje_intentar_asignar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'sin_chofer' and new.chofer_id is null and new.hora_asignacion <= now() then
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
-- Anular un viaje (gestión). Si tenía chofer, el chofer vuelve al puesto 1 de la cola.
---------------------------------------------------------------------------
create or replace function public.anular_viaje(viaje bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
  primero timestamptz;
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'Solo para gestión'; end if;

  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));

  select * into v from public.viajes where id = viaje for update;
  if not found then raise exception 'Viaje no encontrado'; end if;
  if v.estado not in ('sin_chofer', 'asignado') then raise exception 'Este viaje ya terminó; no se puede anular.'; end if;

  update public.viajes
  set estado = 'anulado', anulado_en = now(), anulado_por = auth.uid()
  where id = viaje;

  if v.estado = 'asignado' and v.chofer_id is not null then
    select min(anunciado_en) into primero from public.choferes where estado = 'en_cola';

    -- Vuelve al puesto 1 (los ocultos no van a la cola: quedan libres).
    update public.choferes
    set estado = case when oculto then 'libre' else 'en_cola' end,
        anunciado_en = case when oculto then null
                            else coalesce(primero - interval '1 second', clock_timestamp()) end,
        estado_desde = now()
    where id = v.chofer_id and estado = 'en_viaje';

    -- Puede que haya otro viaje esperando: se le asigna enseguida.
    perform public.asignar_pendientes();
  end if;
end;
$$;

---------------------------------------------------------------------------
-- El chofer ve sus propios viajes (con los datos del cliente).
---------------------------------------------------------------------------
create policy "chofer ve sus viajes" on public.viajes
  for select to authenticated
  using (public.mi_rol() = 'chofer' and chofer_id = auth.uid());
