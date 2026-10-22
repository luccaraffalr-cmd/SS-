-- Los choferes pueden tomar los viajes sin chofer (decidido el 22/10/2026; reemplaza "por ahora solo los ve" del 28/9).
--   - Cuando un viaje se queda sin chofer (llegó su hora y la cola no lo tomó), se espera 1 minuto: si alguien se anuncia,
--     se le ofrece como siempre (2:30 para aceptar).
--   - Pasado el minuto, en el cartel de viajes sin chofer aparece "✋ Tomar este viaje" y a los choferes que están trabajando
--     (no fuera de servicio, no ocultos) les suena "🆘 Viaje sin chofer". El primero que lo toma se lo queda, sin aceptar:
--     si estaba libre o en la cola, sale a hacerlo en el momento; si estaba en viaje, le queda como próximo viaje.
--   - Los viajes que esperan a gestión (rechazados a mano, chofer fijo) no se pueden tomar.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

alter table public.viajes
  add column sin_chofer_desde timestamptz,  -- desde cuándo está sin chofer (para el minuto de espera)
  add column aviso_tomar_en   timestamptz;  -- cuándo se les avisó a los choferes que lo pueden tomar

update public.viajes set sin_chofer_desde = now() where estado = 'sin_chofer';

-- Cada vez que un viaje queda sin chofer, empieza a contar el minuto (y se vuelve a avisar si hace falta).
create or replace function public.viajes_sin_chofer_desde()
returns trigger
language plpgsql
as $$
begin
  if new.estado = 'sin_chofer' and (tg_op = 'INSERT' or old.estado is distinct from 'sin_chofer') then
    new.sin_chofer_desde := now();
    new.aviso_tomar_en := null;
  end if;
  return new;
end;
$$;

create trigger viajes_sin_chofer_desde
  before insert or update on public.viajes
  for each row execute function public.viajes_sin_chofer_desde();

-- Desde cuándo se puede tomar (null = no se puede: tiene chofer o espera a gestión).
-- Un minuto después de que necesita chofer: su hora de asignación o cuando quedó sin chofer, lo que sea más tarde.
create or replace function public.tomar_desde(v public.viajes)
returns timestamptz
language sql
stable
as $$
  select case when v.estado = 'sin_chofer' and not v.espera_gestion
              then greatest(v.hora_asignacion, coalesce(v.sin_chofer_desde, v.hora_asignacion)) + interval '1 minute' end
$$;

---------------------------------------------------------------------------
-- Tomar un viaje (el chofer, desde el cartel de viajes sin chofer).
---------------------------------------------------------------------------

create or replace function public.tomar_viaje(viaje bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
  c public.choferes;
begin
  if public.mi_rol() is distinct from 'chofer' then raise exception 'Solo para choferes'; end if;
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));

  select * into c from public.choferes where id = auth.uid() for update;
  if c.oculto then raise exception 'Solo recibís viajes que te asigna gestión.'; end if;
  if c.estado = 'fuera_de_servicio' then raise exception 'Para tomar un viaje, primero tocá "Empezar a trabajar".'; end if;
  if exists (select 1 from public.viajes o where o.chofer_id = auth.uid() and o.estado = 'ofrecido') then
    raise exception 'Primero aceptá o rechazá el viaje que te ofrecieron.';
  end if;

  select * into v from public.viajes where id = viaje for update;
  if not found or v.estado <> 'sin_chofer' then
    raise exception 'Este viaje ya lo tomó otro chofer o ya no está disponible.';
  end if;
  if public.tomar_desde(v) is null or public.tomar_desde(v) > now() then
    raise exception 'Este viaje todavía no se puede tomar.';
  end if;

  update public.viajes
  set estado = 'asignado', chofer_id = auth.uid(), asignado_en = now(), aceptado_en = now(), asignado_por = null,
      oferta_vence = null
  where id = viaje;
  update public.choferes set ultimo_reporte = now() where id = auth.uid();
  perform public.registrar(viaje, public.nombre_de(auth.uid()) || ' tomó el viaje desde la app');

  -- Libre o en la cola: sale a hacerlo ahora. En viaje: le queda como próximo viaje.
  if c.estado <> 'en_viaje' then
    perform public.iniciar_viaje_interno(viaje, auth.uid());
  end if;
end;
$$;
revoke execute on function public.tomar_viaje(bigint) from public, anon;

-- Lo que ven los choferes (igual que en 016, más desde cuándo se puede tomar cada viaje).
drop function public.viajes_esperando();
create function public.viajes_esperando()
returns table (id bigint, estado text, tipo text, hora_presentacion timestamptz, hora_asignacion timestamptz,
               origen text, destino text, tomar_desde timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.estado, v.tipo, v.hora_presentacion, v.hora_asignacion,
         case when v.hora_asignacion <= now() then v.origen end,
         case when v.hora_asignacion <= now() then v.destino end,
         public.tomar_desde(v)
  from public.viajes v
  where public.mi_rol() is not null
    and (v.estado = 'sin_chofer' or (v.estado = 'ofrecido' and v.asignado_por is null))
    and v.hora_asignacion <= now() + interval '24 hours'
  order by v.hora_asignacion, v.id
$$;

---------------------------------------------------------------------------
-- Aviso "🆘 Viaje sin chofer" a los choferes que lo pueden tomar (una vez por viaje, cuando se habilita).
---------------------------------------------------------------------------

-- Igual que crear_aviso (023) pero sin anotarlo en el historial (sirve para avisar a muchos a la vez).
create or replace function public.enviar_aviso(p_viaje bigint, p_chofer uuid, p_titulo text, p_cuerpo text, p_etiqueta text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  nuevo bigint;
begin
  insert into public.avisos (viaje_id, chofer_id, titulo, cuerpo, etiqueta)
  values (p_viaje, p_chofer, p_titulo, p_cuerpo, p_etiqueta)
  returning id into nuevo;

  perform net.http_post(
    url := 'https://yomjqdbaatydpvazkvvg.supabase.co/functions/v1/notificar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvbWpxZGJhYXR5ZHB2YXprdnZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MDAzODUsImV4cCI6MjEwNjE3NjM4NX0.7qNU5RVjZ-am6wg5qXf9J85wikDHstVemt8fJaoOca4'
    ),
    body := jsonb_build_object('aviso_id', nuevo)
  );
end;
$$;
revoke execute on function public.enviar_aviso(bigint, uuid, text, text, text) from public, anon, authenticated;

-- Cada minuto: los viajes que se acaban de habilitar para tomar.
-- (Los de más de 2 horas atrás no se avisan: ya es tarde y gestión los ve en el cartel rojo.)
create or replace function public.avisar_viajes_para_tomar()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
  c record;
begin
  for v in
    select x.* from public.viajes x
    where x.estado = 'sin_chofer' and not x.espera_gestion and x.aviso_tomar_en is null
      and public.tomar_desde(x) <= now() and x.hora_asignacion > now() - interval '2 hours'
    for update of x skip locked
  loop
    update public.viajes set aviso_tomar_en = now() where id = v.id;
    for c in
      select ch.id from public.choferes ch join public.perfiles p on p.id = ch.id
      where ch.estado <> 'fuera_de_servicio' and not ch.oculto and p.activo and p.rol = 'chofer'
    loop
      perform public.enviar_aviso(v.id, c.id, '🆘 Viaje sin chofer',
        public.texto_cuando(v.tipo, v.hora_presentacion) || E'\nBuscar en: ' || v.origen
          || coalesce(E'\nLlevar a: ' || v.destino, '')
          || E'\nEntrá a la app para tomarlo: el primero que lo toma se lo queda.',
        'tomar-' || v.id);
    end loop;
    perform public.registrar(v.id, 'Se les avisó a los choferes que lo pueden tomar', null);
  end loop;
end;
$$;
revoke execute on function public.avisar_viajes_para_tomar() from public, anon, authenticated;

select cron.schedule('aviso-viajes-para-tomar', '* * * * *', 'select public.avisar_viajes_para_tomar()');
