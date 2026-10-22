-- Avisos a los administradores (decidido el 21/10/2026, pedido del dueño):
--   1) "📣 Salió un viaje para Juan": el mismo aviso que les llega a los choferes cuando la cola ofrece un viaje
--      (lo manda la función "notificar"; acá no hace falta nada).
--   2) Las alertas del cartel rojo de gestión, con sonido, cuando un viaje llega a su hora de asignación y:
--      "⚠️ Viaje sin chofer", "⏳ Juan no aceptó el viaje" (asignado a mano o de chofer fijo) o
--      "⏰ Juan no salió" (3 minutos después de la hora de salir, para darle tiempo al chofer).
--      Cada alerta suena una sola vez; si el viaje cambia de estado, de chofer o de horario y vuelve a tener un
--      problema, suena de nuevo.
-- ⚠️ Antes de correr esto, subir la versión nueva de la función "notificar" (suena con el sonido propio).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

alter table public.viajes add column alerta_gestion_en timestamptz;  -- cuándo se les avisó a los admins del problema

-- Si el viaje cambia de estado, de chofer o de horario, un problema nuevo se vuelve a avisar.
create or replace function public.viajes_reiniciar_alerta()
returns trigger
language plpgsql
as $$
begin
  if new.estado is distinct from old.estado or new.chofer_id is distinct from old.chofer_id
     or new.hora_asignacion is distinct from old.hora_asignacion then
    new.alerta_gestion_en := null;
  end if;
  return new;
end;
$$;

create trigger viajes_reiniciar_alerta
  before update on public.viajes
  for each row execute function public.viajes_reiniciar_alerta();

-- Cada minuto: los viajes del cartel rojo que todavía no se avisaron (los mismos que muestra problemaDelViaje en la app).
-- (Los de más de 2 horas atrás no se avisan: ya es tarde y gestión los ve en el cartel rojo.)
create or replace function public.avisar_alertas_gestion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v      public.viajes;
  a      record;
  titulo text;
  cuerpo text;
begin
  for v in
    select * from public.viajes
    where alerta_gestion_en is null and iniciado_en is null
      and hora_asignacion > now() - interval '2 hours'
      and ((estado = 'sin_chofer' and hora_asignacion <= now())
        or (estado = 'ofrecido' and asignado_por is not null and hora_asignacion <= now())
        or (estado = 'asignado' and hora_asignacion <= now() - interval '3 minutes'))
    for update skip locked
  loop
    update public.viajes set alerta_gestion_en = now() where id = v.id;
    titulo := case v.estado
      when 'sin_chofer' then '⚠️ Viaje sin chofer'
      when 'ofrecido' then '⏳ ' || public.nombre_de(v.chofer_id) || ' no aceptó el viaje'
      else '⏰ ' || public.nombre_de(v.chofer_id) || ' no salió'
    end;
    cuerpo := public.texto_cuando(v.tipo, v.hora_presentacion)
      || coalesce(E'\nCliente: ' || v.cliente_nombre, '')
      || E'\n' || public.texto_recorrido(v.origen, v.destino)
      || case when v.estado = 'sin_chofer' and v.espera_gestion and v.rechazado_por is not null
              then E'\nLo rechazó ' || public.nombre_de(v.rechazado_por) else '' end;
    for a in select id from public.perfiles where rol = 'admin' and activo loop
      perform public.crear_aviso(v.id, a.id, titulo, cuerpo, 'alerta-' || v.id);
    end loop;
  end loop;
end;
$$;
revoke execute on function public.avisar_alertas_gestion() from public, anon, authenticated;

-- Los que ya están en el cartel rojo ahora no se avisan (para que no suenen todos juntos al correr esto).
update public.viajes set alerta_gestion_en = now()
where iniciado_en is null and hora_asignacion <= now()
  and (estado in ('sin_chofer', 'asignado') or (estado = 'ofrecido' and asignado_por is not null));

select cron.schedule('aviso-alertas-gestion', '* * * * *', 'select public.avisar_alertas_gestion()');
