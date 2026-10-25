-- Recorrido del viaje, segunda parte (pedido del dueño, 24/10/2026):
--   - "Demora": suma solo las veces que el auto estuvo detenido 3 minutos o más (antes, 2). Así, si se frena en el
--     tránsito no cuenta como demora.
--   - Dónde estuvo detenido: cada parada de 3 minutos o más (lugar, desde, hasta, minutos), para marcarla en rojo en el mapa.
-- Igual que en 036; se vuelven a calcular los recorridos guardados que todavía tienen sus ubicaciones (7 días).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

-- { km, minutos, demora_min, paradas: [{ lat, lon, desde, hasta, minutos }], puntos: [[lat, lon]…], desde, hasta, en_curso }
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
  demora double precision := 0;   -- segundos, paradas de 3 minutos o más
  racha double precision := 0;    -- segundos de la parada que se está midiendo
  racha_lat double precision;     -- dónde y desde cuándo está parado
  racha_lon double precision;
  racha_desde timestamptz;
  paradas jsonb := '[]';
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
        -- Casi quieto (menos de 5 km/h).
        if racha = 0 then
          racha_lat := ant.lat;
          racha_lon := ant.lon;
          racha_desde := ant.reportado_en;
        end if;
        racha := racha + dt;
      else
        if racha >= 180 then
          demora := demora + racha;
          paradas := paradas || jsonb_build_object('lat', round(racha_lat::numeric, 5), 'lon', round(racha_lon::numeric, 5),
            'desde', racha_desde, 'hasta', ant.reportado_en, 'minutos', round(racha / 60));
        end if;
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
  if racha >= 180 then
    demora := demora + racha;
    paradas := paradas || jsonb_build_object('lat', round(racha_lat::numeric, 5), 'lon', round(racha_lon::numeric, 5),
      'desde', racha_desde, 'hasta', ant.reportado_en, 'minutos', round(racha / 60));
  end if;
  -- Que el mapa termine en la última ubicación.
  if hay_ant and (i - 1) % cada <> 0 then
    puntos := puntos || jsonb_build_array(jsonb_build_array(round(ant.lat::numeric, 5), round(ant.lon::numeric, 5)));
  end if;

  return jsonb_build_object(
    'km', round((metros / 1000)::numeric, 1),
    'minutos', round(extract(epoch from hasta - v.iniciado_en) / 60),
    'demora_min', round(demora / 60),
    'paradas', paradas,
    'puntos', puntos,
    'desde', v.iniciado_en,
    'hasta', hasta,
    'en_curso', v.finalizado_en is null and v.estado = 'asignado');
end;
$$;
revoke execute on function public.calcular_recorrido(bigint) from public, anon, authenticated;

-- Se vuelven a calcular los guardados que todavía tienen ubicaciones (los últimos 7 días).
update public.recorridos r
set datos = public.calcular_recorrido(r.viaje_id), guardado_en = now()
from public.viajes v
where v.id = r.viaje_id and v.finalizado_en > now() - interval '7 days';
