-- Limpieza (29/9/2026), decidido con el usuario:
--   1) Se deja de usar Traccar: la ubicación viene solo de la app Android de cada chofer.
--   2) Se arranca de cero: se borran TODOS los viajes (con sus ofertas, pagos e historial), los viajes fijos,
--      las ubicaciones y los usuarios de prueba (prueba1 y prueba2). Quedan los usuarios reales, los choferes,
--      las comisiones y las cuentas corrientes. Los números de viaje vuelven a empezar desde 1.
-- ⚠️ No se puede deshacer. Se ejecuta una sola vez en Supabase → SQL Editor.

---------------------------------------------------------------------------
-- Parte 1: arrancar de cero.
---------------------------------------------------------------------------

truncate table public.ofertas, public.cambios_pago, public.registro, public.viajes, public.viajes_fijos
  restart identity;

-- Usuarios de prueba (borra también su perfil, ficha de chofer, comisión, avisos y claves).
delete from auth.users where id in (select id from public.perfiles where usuario in ('prueba1', 'prueba2'));

-- Todos los choferes arrancan fuera de servicio y sin cola.
update public.choferes set estado = 'fuera_de_servicio', estado_desde = now(), anunciado_en = null;

-- Claves de celulares (cada app pide una nueva sola al abrirse).
delete from public.claves_ubicacion;

---------------------------------------------------------------------------
-- Parte 2: sin Traccar. La ubicación queda guardada por chofer (antes era por "equipo").
---------------------------------------------------------------------------

drop function public.reportar_ubicacion(text, text, double precision, double precision, integer);
drop table public.config_privada;
alter table public.choferes drop column equipo_traccar;

drop table public.ubicaciones;
drop table public.historial_ubicacion;

-- Última ubicación de cada chofer.
create table public.ubicaciones (
  chofer_id    uuid primary key references public.perfiles (id) on delete cascade,
  lat          double precision not null,
  lon          double precision not null,
  velocidad    integer not null default 0,  -- km/h
  precision_m  integer,
  reportado_en timestamptz not null default now()
);
alter table public.ubicaciones enable row level security;
create policy "gestion ve ubicaciones" on public.ubicaciones
  for select to authenticated using (public.mi_rol() in ('admin', 'operador'));

-- Historial de los últimos 7 días (para medir cortes de señal).
create table public.historial_ubicacion (
  id           bigint generated always as identity primary key,
  chofer_id    uuid not null references public.perfiles (id) on delete cascade,
  lat          double precision not null,
  lon          double precision not null,
  precision_m  integer,
  reportado_en timestamptz not null default now()
);
create index historial_ubicacion_chofer on public.historial_ubicacion (chofer_id, reportado_en);
alter table public.historial_ubicacion enable row level security;
create policy "gestion ve el historial de ubicacion" on public.historial_ubicacion
  for select to authenticated using (public.mi_rol() in ('admin', 'operador'));

-- La llama el celular (sin sesión, con su clave) cada vez que tiene una ubicación nueva.
-- Devuelve el estado del chofer: si está fuera de servicio, la app deja de mandar.
create or replace function public.reportar_mi_ubicacion(p_clave text, p_lat double precision, p_lon double precision,
  p_velocidad integer default 0, p_precision integer default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chofer uuid;
begin
  select k.chofer_id into v_chofer
  from public.claves_ubicacion k join public.perfiles p on p.id = k.chofer_id and p.activo
  where k.clave = p_clave;
  if v_chofer is null then raise exception 'Clave incorrecta'; end if;
  if p_lat not between -90 and 90 or p_lon not between -180 and 180 then raise exception 'Datos inválidos'; end if;

  insert into public.ubicaciones (chofer_id, lat, lon, velocidad, precision_m, reportado_en)
  values (v_chofer, p_lat, p_lon, greatest(coalesce(p_velocidad, 0), 0), p_precision, now())
  on conflict (chofer_id) do update
  set lat = excluded.lat, lon = excluded.lon, velocidad = excluded.velocidad,
      precision_m = excluded.precision_m, reportado_en = excluded.reportado_en;

  insert into public.historial_ubicacion (chofer_id, lat, lon, precision_m) values (v_chofer, p_lat, p_lon, p_precision);
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

-- Link del pasajero: la ubicación del chofer del viaje.
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
  select * into u from public.ubicaciones where chofer_id = v.chofer_id;

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

-- Qué quedó (para revisar abajo, en "Results").
select
  (select count(*) from public.viajes) as viajes,
  (select count(*) from public.viajes_fijos) as viajes_fijos,
  (select count(*) from public.perfiles where rol = 'chofer') as choferes,
  (select count(*) from public.perfiles where rol <> 'chofer') as usuarios_de_gestion,
  (select count(*) from public.cuentas_corrientes) as cuentas_corrientes;
