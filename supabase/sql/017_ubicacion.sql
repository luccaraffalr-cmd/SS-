-- Etapa 2, parte 1: ubicación de los autos, mapa de gestión y link de seguimiento para el pasajero.
-- La ubicación la manda Traccar Client al servidor de Render, y Render la reenvía acá.
-- Se ejecuta una sola vez en Supabase → SQL Editor. Al final muestra la clave para cargar en Render.

---------------------------------------------------------------------------
-- Parte 1: ubicaciones.
---------------------------------------------------------------------------

-- Número del chofer en Traccar Client (el "identificador del dispositivo": 1, 2, 3…).
alter table public.choferes add column equipo_traccar text unique;

-- Última ubicación de cada equipo (no se guarda el recorrido).
create table public.ubicaciones (
  equipo       text primary key,
  lat          double precision not null,
  lon          double precision not null,
  velocidad    integer not null default 0,  -- km/h
  reportado_en timestamptz not null default now()
);

alter table public.ubicaciones enable row level security;
create policy "gestion ve ubicaciones" on public.ubicaciones
  for select to authenticated using (public.mi_rol() in ('admin', 'operador'));

alter publication supabase_realtime add table public.ubicaciones;

-- Datos que no se pueden leer desde la app (sin reglas de acceso: solo desde el SQL Editor).
create table public.config_privada (
  nombre text primary key,
  valor  text not null
);
alter table public.config_privada enable row level security;

-- Clave que usa el servidor de Render para mandar ubicaciones.
insert into public.config_privada (nombre, valor)
values ('clave_ubicaciones', replace(gen_random_uuid()::text, '-', ''));

-- La llama el servidor de Render cada vez que un celular manda su ubicación.
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
end;
$$;
revoke execute on function public.reportar_ubicacion(text, text, double precision, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.reportar_ubicacion(text, text, double precision, double precision, integer) to anon;

---------------------------------------------------------------------------
-- Parte 2: link de seguimiento para el pasajero.
---------------------------------------------------------------------------

alter table public.viajes add column codigo_seguimiento text unique;

-- Gestión toca "Compartir": se crea el código del link (o se reutiliza si ya existía).
create or replace function public.compartir_viaje(viaje bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'No permitido'; end if;

  select * into v from public.viajes where id = viaje for update;
  if v.chofer_id is null or v.estado not in ('ofrecido', 'asignado') then
    raise exception 'Solo se puede compartir un viaje que tiene chofer y todavía no terminó.';
  end if;

  if v.codigo_seguimiento is null then
    update public.viajes set codigo_seguimiento = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
    where id = viaje
    returning * into v;
    perform public.registrar(viaje, 'Se generó el link de seguimiento');
  end if;
  return v.codigo_seguimiento;
end;
$$;
revoke execute on function public.compartir_viaje(bigint) from public, anon;

-- Lo que ve el pasajero con el link (no hace falta usuario). Nunca muestra datos del cliente.
-- El link deja de mostrar el auto cuando el viaje se finaliza o se anula.
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
  select * into u from public.ubicaciones where equipo = ch.equipo_traccar;

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
revoke execute on function public.ver_seguimiento(text) from public;
grant execute on function public.ver_seguimiento(text) to anon, authenticated;

-- La clave para cargar en Render (aparece abajo, en "Results").
select valor as clave_para_render from public.config_privada where nombre = 'clave_ubicaciones';
