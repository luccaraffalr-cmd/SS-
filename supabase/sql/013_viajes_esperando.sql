-- Tarea 13: los choferes ven los viajes que esperan chofer, solo con el horario
-- (sin direcciones ni datos del cliente), para saber si hace falta salir a trabajar.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

create or replace function public.viajes_esperando()
returns table (id bigint, tipo text, hora_presentacion timestamptz, hora_asignacion timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.tipo, v.hora_presentacion, v.hora_asignacion
  from public.viajes v
  where public.mi_rol() is not null
    -- sin chofer, o con una oferta automática que todavía nadie aceptó
    and (v.estado = 'sin_chofer' or (v.estado = 'ofrecido' and v.oferta_vence is not null))
    -- los que ya se pueden asignar y los programados de las próximas 24 horas
    and v.hora_asignacion <= now() + interval '24 hours'
  order by coalesce(v.hora_presentacion, v.hora_asignacion), v.id
$$;
