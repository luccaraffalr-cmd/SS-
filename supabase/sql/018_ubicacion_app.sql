-- Etapa 2, parte 2 (prueba): la app Android propia manda la ubicación directo a Supabase.
-- Cada celular tiene su propia clave (la crea la app cuando el chofer entra con su usuario).
-- En la tabla ubicaciones, lo que manda la app se guarda como equipo 'app:<id del chofer>'.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

-- Claves de los celulares con la app (no se pueden leer desde la app: sin reglas de acceso).
create table public.claves_ubicacion (
  clave     text primary key,
  chofer_id uuid not null references public.perfiles (id) on delete cascade,
  creada_en timestamptz not null default now()
);
alter table public.claves_ubicacion enable row level security;

-- Historial de ubicaciones de los últimos 7 días (para medir cortes de señal).
create table public.historial_ubicacion (
  id           bigint generated always as identity primary key,
  equipo       text not null,
  lat          double precision not null,
  lon          double precision not null,
  precision_m  integer,
  reportado_en timestamptz not null default now()
);
create index historial_ubicacion_equipo on public.historial_ubicacion (equipo, reportado_en);
alter table public.historial_ubicacion enable row level security;
create policy "gestion ve el historial de ubicacion" on public.historial_ubicacion
  for select to authenticated using (public.mi_rol() in ('admin', 'operador'));

-- El chofer (ya logueado en la app) pide la clave para su celular.
create or replace function public.crear_clave_ubicacion()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  nueva text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if public.mi_rol() is distinct from 'chofer' then raise exception 'Solo los choferes comparten su ubicación.'; end if;
  insert into public.claves_ubicacion (clave, chofer_id) values (nueva, auth.uid());
  return nueva;
end;
$$;
revoke execute on function public.crear_clave_ubicacion() from public, anon;

-- La llama el celular (sin sesión, con su clave) cada vez que tiene una ubicación nueva.
-- Devuelve el estado del chofer (para más adelante: apagarse solo al "Terminar el día").
create or replace function public.reportar_mi_ubicacion(p_clave text, p_lat double precision, p_lon double precision,
  p_velocidad integer default 0, p_precision integer default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chofer uuid;
  v_equipo text;
begin
  select k.chofer_id into v_chofer
  from public.claves_ubicacion k join public.perfiles p on p.id = k.chofer_id and p.activo
  where k.clave = p_clave;
  if v_chofer is null then raise exception 'Clave incorrecta'; end if;
  if p_lat not between -90 and 90 or p_lon not between -180 and 180 then raise exception 'Datos inválidos'; end if;

  v_equipo := 'app:' || v_chofer;
  insert into public.ubicaciones (equipo, lat, lon, velocidad, reportado_en)
  values (v_equipo, p_lat, p_lon, greatest(coalesce(p_velocidad, 0), 0), now())
  on conflict (equipo) do update
  set lat = excluded.lat, lon = excluded.lon, velocidad = excluded.velocidad, reportado_en = excluded.reportado_en;

  insert into public.historial_ubicacion (equipo, lat, lon, precision_m) values (v_equipo, p_lat, p_lon, p_precision);
  -- De vez en cuando, borra lo de más de 7 días.
  if random() < 0.002 then
    delete from public.historial_ubicacion where reportado_en < now() - interval '7 days';
  end if;

  return (select estado from public.choferes where id = v_chofer);
end;
$$;
revoke execute on function public.reportar_mi_ubicacion(text, double precision, double precision, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reportar_mi_ubicacion(text, double precision, double precision, integer, integer) to anon;

-- Lo que manda Render (Traccar) también queda en el historial, para comparar las dos apps.
create or replace function public.reportar_ubicacion(p_clave text, p_equipo text,
  p_lat double precision, p_lon double precision, p_velocidad integer default 0)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_clave is distinct from (select valor from public.config_privada where nombre = 'clave_ubicaciones') then
    raise exception 'Clave incorrecta';
  end if;
  if nullif(trim(p_equipo), '') is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'Datos inválidos';
  end if;

  insert into public.ubicaciones (equipo, lat, lon, velocidad, reportado_en)
  values (trim(p_equipo), p_lat, p_lon, greatest(coalesce(p_velocidad, 0), 0), now())
  on conflict (equipo) do update
  set lat = excluded.lat, lon = excluded.lon, velocidad = excluded.velocidad, reportado_en = excluded.reportado_en;

  insert into public.historial_ubicacion (equipo, lat, lon) values (trim(p_equipo), p_lat, p_lon);
end;
$$;

-- El link del pasajero usa la ubicación más reciente del chofer: la de la app o la de Traccar.
create or replace function public.ver_seguimiento(codigo text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.viajes;
  ch public.choferes;
  u public.ubicaciones;
begin
  select * into v from public.viajes where codigo_seguimiento = codigo;
  if not found then return json_build_object('estado', 'inexistente'); end if;
  if v.estado not in ('ofrecido', 'asignado', 'sin_chofer') then return json_build_object('estado', 'terminado'); end if;
  if v.chofer_id is null then return json_build_object('estado', 'sin_chofer'); end if;

  select * into ch from public.choferes where id = v.chofer_id;
  select * into u from public.ubicaciones
  where equipo in (ch.equipo_traccar, 'app:' || ch.id)
  order by reportado_en desc limit 1;

  return json_build_object(
    'estado', 'activo',
    'chofer', public.nombre_de(v.chofer_id),
    'modelo', ch.auto_modelo,
    'color', ch.auto_color,
    'patente', ch.patente,
    'foto', ch.foto_auto,
    'lat', u.lat,
    'lon', u.lon,
    'velocidad', u.velocidad,
    'segundos', case when u.reportado_en is not null then extract(epoch from now() - u.reportado_en)::int end
  );
end;
$$;
