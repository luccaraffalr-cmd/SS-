-- App Android, versión 2 (19/10/2026):
--   1) Actualizarse sola: la tabla "config_app" dice cuál es la última versión de la app y de dónde bajarla
--      (carpeta pública "app" de Storage). La app compara con la suya y ofrece "Actualizar".
--   2) Avisos con sonido propio: cada celular guarda con su token de avisos la versión de la app, así "notificar"
--      usa el canal con sonido propio solo en las apps que lo tienen (la versión 1 no lo tiene).
--   3) Ubicación que ahorra batería: el servidor le dice al celular cada cuántos segundos mandar
--      (en viaje más seguido, libre o en cola menos). Se ajusta cambiando config_app, sin otra app.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

---------------------------------------------------------------------------
-- 1) y 3) Configuración de la app (una sola fila).
---------------------------------------------------------------------------

create table public.config_app (
  id                     integer primary key default 1 check (id = 1),
  version_codigo         integer not null default 1,   -- versionCode de la última app (android/app/build.gradle)
  version_nombre         text not null default '1.0',  -- versionName (lo que se muestra)
  apk_url                text,                         -- de dónde se baja
  novedades              text,                         -- qué trae (se muestra en el aviso)
  ubicacion_seg_en_viaje integer not null default 10 check (ubicacion_seg_en_viaje between 5 and 600),
  ubicacion_seg_libre    integer not null default 30 check (ubicacion_seg_libre between 5 and 600)
);
insert into public.config_app (id) values (1);
alter table public.config_app enable row level security;
-- La ve cualquiera que use la app (también antes de entrar, para avisar que hay una versión nueva).
create policy "todos ven la config de la app" on public.config_app for select to anon, authenticated using (true);

-- Carpeta pública para el archivo de la app (se sube con la CLI de Supabase).
insert into storage.buckets (id, name, public) values ('app', 'app', true)
on conflict (id) do nothing;

---------------------------------------------------------------------------
-- 2) Versión de la app de cada celular, junto a su token de avisos.
---------------------------------------------------------------------------

alter table public.tokens_app add column version integer;  -- vacío = versión 1 (no la informaba)

drop function public.guardar_token_app(text);
create or replace function public.guardar_token_app(p_token text, p_version integer default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.tokens_app (token, perfil_id, version)
  select p_token, auth.uid(), p_version
  where public.mi_rol() is not null and nullif(trim(p_token), '') is not null
  on conflict (token) do update set perfil_id = excluded.perfil_id, version = excluded.version, creado_en = now();
$$;
revoke execute on function public.guardar_token_app(text, integer) from public, anon;

---------------------------------------------------------------------------
-- 3) La ubicación responde el estado y cada cuántos segundos mandar.
--    (La app vieja busca "fuera_de_servicio" en la respuesta: sigue andando con este formato.)
---------------------------------------------------------------------------

drop function public.reportar_mi_ubicacion(text, double precision, double precision, integer, integer);
create or replace function public.reportar_mi_ubicacion(p_clave text, p_lat double precision, p_lon double precision,
  p_velocidad integer default 0, p_precision integer default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chofer uuid;
  v_estado text;
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

  select estado into v_estado from public.choferes where id = v_chofer;
  return json_build_object(
    'estado', v_estado,
    'cada', (select case when v_estado = 'en_viaje' then ubicacion_seg_en_viaje else ubicacion_seg_libre end
             from public.config_app where id = 1));
end;
$$;
revoke execute on function public.reportar_mi_ubicacion(text, double precision, double precision, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reportar_mi_ubicacion(text, double precision, double precision, integer, integer) to anon;
