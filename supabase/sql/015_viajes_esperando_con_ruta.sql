-- Los choferes ven:
--   * "Próximos viajes": programados sin chofer de las próximas 24 h (solo la hora de asignación).
--   * El cartel de viajes sin chofer que ya se tendrían que estar haciendo, con origen y destino
--     (nunca los datos del cliente).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

drop function if exists public.viajes_esperando();

create or replace function public.viajes_esperando()
returns table (id bigint, estado text, tipo text, hora_presentacion timestamptz, hora_asignacion timestamptz,
               origen text, destino text)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.estado, v.tipo, v.hora_presentacion, v.hora_asignacion,
         -- el origen y destino solo de los que ya se pueden asignar
         case when v.hora_asignacion <= now() then v.origen end,
         case when v.hora_asignacion <= now() then v.destino end
  from public.viajes v
  where public.mi_rol() is not null
    and (v.estado = 'sin_chofer' or (v.estado = 'ofrecido' and v.oferta_vence is not null))
    and v.hora_asignacion <= now() + interval '24 hours'
  order by v.hora_asignacion, v.id
$$;
