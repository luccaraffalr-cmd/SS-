-- Recorrido de cada viaje (pedido del dueño, 24/10/2026; por ahora para controlar, más adelante para calcular precios):
-- desde que el chofer toca "Salir a hacer el viaje" hasta que lo finaliza, con las ubicaciones que manda la app (cada
-- 10 segundos, guardadas 7 días en historial_ubicacion). Al finalizar se guarda para siempre en "recorridos":
--   - km (aproximados: se suman los tramos entre ubicaciones; los saltos imposibles y el "temblor" del GPS no cuentan),
--   - duración total,
--   - tiempo parado: la suma de las paradas de 2 minutos o más (los semáforos no cuentan). La espera del cliente no se
--     puede medir exacta (el auto puede moverse mientras espera): es un dato aproximado.
-- Gestión lo ve en el viaje, con el mapa. Mientras el viaje se está haciendo, se calcula en el momento.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

-- Distancia en metros entre dos puntos (fórmula de haversine).
create or replace function public.distancia_m(lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision)
returns double precision
language sql
immutable
as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)))
$$;

-- Calcula el recorrido de un viaje con las ubicaciones guardadas (null si nunca salió).
-- { km, minutos, parado_min, puntos: [[lat, lon]…] (como mucho ~500), desde, hasta, en_curso }
create or replace function public.calcular_recorrido(p_viaje bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.viajes;
  hasta timestamptz;
  p record;
  ant record;
  hay_ant boolean := false;
  d double precision;
  dt double precision;
  metros double precision := 0;
  parado double precision := 0;  -- segundos, paradas de 2 minutos o más
  racha double precision := 0;   -- segundos de la parada que se está midiendo
  total integer;
  cada integer;
  i integer := 0;
  puntos jsonb := '[]';
begin
  select * into v from public.viajes where id = p_viaje;
  if not found or v.iniciado_en is null or v.chofer_id is null then return null; end if;
  hasta := coalesce(v.finalizado_en, v.anulado_en, now());  -- si lo anularon mientras lo hacía, hasta ahí

  select count(*) into total from public.historial_ubicacion
  where chofer_id = v.chofer_id and reportado_en between v.iniciado_en and hasta;
  cada := greatest(1, ceil(total / 500.0)::integer);  -- para el mapa alcanza con unos 500 puntos

  for p in
    select lat, lon, reportado_en from public.historial_ubicacion
    where chofer_id = v.chofer_id and reportado_en between v.iniciado_en and hasta
      and coalesce(precision_m, 0) <= 100  -- ubicaciones muy imprecisas no
    order by reportado_en
  loop
    if hay_ant then
      d := public.distancia_m(ant.lat, ant.lon, p.lat, p.lon);
      dt := extract(epoch from p.reportado_en - ant.reportado_en);
      continue when dt <= 0;
      continue when d / dt > 60;  -- salto imposible (más de 200 km/h): ubicación mala, se saltea
      if d >= 15 then metros := metros + d; end if;  -- menos de 15 m es el GPS "temblando" con el auto quieto
      if d / dt < 1.5 then
        racha := racha + dt;  -- casi quieto (menos de 5 km/h)
      else
        if racha >= 120 then parado := parado + racha; end if;
        racha := 0;
      end if;
    end if;
    if i % cada = 0 then
      puntos := puntos || jsonb_build_array(jsonb_build_array(round(p.lat::numeric, 5), round(p.lon::numeric, 5)));
    end if;
    i := i + 1;
    ant := p;
    hay_ant := true;
  end loop;
  if racha >= 120 then parado := parado + racha; end if;
  -- Que el mapa termine en la última ubicación.
  if hay_ant and (i - 1) % cada <> 0 then
    puntos := puntos || jsonb_build_array(jsonb_build_array(round(ant.lat::numeric, 5), round(ant.lon::numeric, 5)));
  end if;

  return jsonb_build_object(
    'km', round((metros / 1000)::numeric, 1),
    'minutos', round(extract(epoch from hasta - v.iniciado_en) / 60),
    'parado_min', round(parado / 60),
    'puntos', puntos,
    'desde', v.iniciado_en,
    'hasta', hasta,
    'en_curso', v.finalizado_en is null and v.estado = 'asignado');
end;
$$;
revoke execute on function public.calcular_recorrido(bigint) from public, anon, authenticated;

-- Los recorridos de los viajes terminados (para siempre: el historial de ubicaciones dura 7 días).
create table public.recorridos (
  viaje_id    bigint primary key references public.viajes (id) on delete cascade on update cascade,
  datos       jsonb not null,
  guardado_en timestamptz not null default now()
);
alter table public.recorridos enable row level security;
create policy "gestion ve los recorridos" on public.recorridos
  for select to authenticated using (public.mi_rol() in ('admin', 'operador'));

-- Al finalizar el viaje (pago, pago después o fallido) se guarda su recorrido.
create or replace function public.viajes_guardar_recorrido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  datos jsonb;
begin
  if old.finalizado_en is null and new.finalizado_en is not null then
    datos := public.calcular_recorrido(new.id);
    if datos is not null then
      datos := datos || jsonb_build_object('en_curso', false, 'hasta', new.finalizado_en);
      insert into public.recorridos (viaje_id, datos) values (new.id, datos)
      on conflict (viaje_id) do update set datos = excluded.datos, guardado_en = now();
    end if;
  end if;
  return null;
end;
$$;

create trigger viajes_guardar_recorrido
  after update of finalizado_en on public.viajes
  for each row execute function public.viajes_guardar_recorrido();

-- Gestión: el recorrido de un viaje (el guardado o, si se está haciendo, el de hasta ahora).
create or replace function public.ver_recorrido(p_viaje bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  guardado jsonb;
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'Solo para gestión'; end if;
  select datos into guardado from public.recorridos where viaje_id = p_viaje;
  return coalesce(guardado, public.calcular_recorrido(p_viaje));
end;
$$;
revoke execute on function public.ver_recorrido(bigint) from public, anon;

-- Los viajes terminados de los últimos 7 días (todavía están sus ubicaciones).
insert into public.recorridos (viaje_id, datos)
select v.id, public.calcular_recorrido(v.id)
from public.viajes v
where v.finalizado_en > now() - interval '7 days' and v.iniciado_en is not null and v.chofer_id is not null
on conflict (viaje_id) do nothing;
