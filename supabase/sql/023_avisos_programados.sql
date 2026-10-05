-- Avisos al chofer (notificación con sonido, en la app y en el navegador), decididos el 2 y el 5/10/2026:
--   1) "🚗 Es hora de salir": a la hora de asignación de un viaje que aceptó y todavía no empezó
--      (le suena aunque esté fuera de servicio).
--   2) "🔄 Cambió tu viaje": si gestión cambia el horario (presentación o asignación), el origen o el destino
--      de un viaje suyo, desde que se lo asignan hasta que lo finaliza. No lo tiene que volver a aceptar.
--   3) "❌ Se anuló tu viaje" / "❌ Te sacaron un viaje": si gestión lo anula o se lo pasa a otro (o lo deja sin chofer).
-- Cada aviso queda anotado en el historial del viaje. Los manda la función "notificar".
-- ⚠️ Antes de correr esto, subir la versión nueva de la función "notificar"
--    (si no, la función vieja ignora estos avisos y se pierden).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

---------------------------------------------------------------------------
-- Textos para los avisos (hora argentina).
---------------------------------------------------------------------------

-- "mar 6/10 14:30"
create or replace function public.texto_fecha_hora(f timestamptz)
returns text
language sql
stable
as $$
  select (array['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'])
           [extract(dow from f at time zone 'America/Argentina/Buenos_Aires')::int + 1]
         || ' ' || to_char(f at time zone 'America/Argentina/Buenos_Aires', 'FMDD/FMMM HH24:MI')
$$;

-- "mar 6/10 14:30" para un programado, "Inmediato" si no.
create or replace function public.texto_cuando(p_tipo text, p_presentacion timestamptz)
returns text
language sql
stable
as $$
  select case when p_tipo = 'programado' and p_presentacion is not null
              then public.texto_fecha_hora(p_presentacion) else 'Inmediato' end
$$;

-- "Rivadavia 2612 → Hospital"
create or replace function public.texto_recorrido(p_origen text, p_destino text)
returns text
language sql
immutable
as $$ select p_origen || coalesce(' → ' || p_destino, '') $$;

---------------------------------------------------------------------------
-- Avisos: se guardan y se le pide a "notificar" que los mande (una sola vez cada uno).
---------------------------------------------------------------------------

create table public.avisos (
  id            bigint generated always as identity primary key,
  viaje_id      bigint references public.viajes (id) on delete cascade,
  chofer_id     uuid not null references public.perfiles (id) on delete cascade,
  titulo        text not null,
  cuerpo        text not null,
  etiqueta      text not null,           -- en Android, un aviso nuevo con la misma etiqueta reemplaza al anterior
  creado_en     timestamptz not null default now(),
  notificado_en timestamptz              -- cuándo lo mandó la función (evita duplicados)
);
alter table public.avisos enable row level security;  -- sin reglas: solo el servidor

create or replace function public.crear_aviso(p_viaje bigint, p_chofer uuid, p_titulo text, p_cuerpo text, p_etiqueta text)
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

  perform public.registrar(p_viaje, 'Aviso a ' || public.nombre_de(p_chofer) || ': ' || p_titulo, null);

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
revoke execute on function public.crear_aviso(bigint, uuid, text, text, text) from public, anon, authenticated;

---------------------------------------------------------------------------
-- 1) Es hora de salir.
---------------------------------------------------------------------------

alter table public.viajes add column aviso_salida_en timestamptz;  -- cuándo se le avisó que es hora de salir

-- Si gestión cambia la hora o el chofer, se vuelve a avisar a la hora nueva (o al chofer nuevo).
create or replace function public.viajes_reiniciar_aviso()
returns trigger
language plpgsql
as $$
begin
  if new.hora_asignacion is distinct from old.hora_asignacion or new.chofer_id is distinct from old.chofer_id then
    new.aviso_salida_en := null;
  end if;
  return new;
end;
$$;

create trigger viajes_reiniciar_aviso
  before update on public.viajes
  for each row execute function public.viajes_reiniciar_aviso();

-- Cada minuto: viajes aceptados cuya hora de asignación llegó y el chofer todavía no salió.
-- (Los de más de 2 horas atrás no se avisan: ya es tarde y gestión los ve en el cartel rojo.)
create or replace function public.avisar_hora_de_salir()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
begin
  for v in
    select * from public.viajes
    where estado = 'asignado' and iniciado_en is null and aviso_salida_en is null
      and hora_asignacion <= now() and hora_asignacion > now() - interval '2 hours'
    for update skip locked
  loop
    update public.viajes set aviso_salida_en = now() where id = v.id;
    perform public.crear_aviso(v.id, v.chofer_id, '🚗 Es hora de salir',
      public.texto_cuando(v.tipo, v.hora_presentacion) || E'\n' || public.texto_recorrido(v.origen, v.destino)
        || E'\nAbrí la app y tocá "Salir a hacer el viaje".',
      'salida-' || v.id);
  end loop;
end;
$$;
revoke execute on function public.avisar_hora_de_salir() from public, anon, authenticated;

select cron.schedule('aviso-hora-de-salir', '* * * * *', 'select public.avisar_hora_de_salir()');

---------------------------------------------------------------------------
-- 2) y 3) Cambios en el viaje, anulación o se lo pasan a otro.
---------------------------------------------------------------------------

create or replace function public.viajes_avisar_cambios()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cambios text[] := '{}';
begin
  -- Lo que hace el propio chofer (rechazar, finalizar…) no se le avisa.
  -- 3) Se lo sacaron: tenía el viaje (ofrecido, aceptado o haciéndolo) y se anuló o pasó a otro / a nadie.
  if old.chofer_id is not null and old.estado in ('ofrecido', 'asignado') and auth.uid() is distinct from old.chofer_id then
    if new.estado = 'anulado' then
      perform public.crear_aviso(new.id, old.chofer_id, '❌ Se anuló tu viaje',
        public.texto_cuando(old.tipo, old.hora_presentacion) || E'\n' || public.texto_recorrido(old.origen, old.destino),
        'viaje-' || new.id);
      return null;
    elsif new.chofer_id is distinct from old.chofer_id then
      perform public.crear_aviso(new.id, old.chofer_id, '❌ Te sacaron un viaje',
        public.texto_cuando(old.tipo, old.hora_presentacion) || E'\n' || public.texto_recorrido(old.origen, old.destino)
          || case when new.chofer_id is null then E'\nGestión lo dejó sin chofer.' else E'\nGestión se lo pasó a otro chofer.' end,
        'viaje-' || new.id);
      return null;
    end if;
  end if;

  -- 2) Cambió el horario, el origen o el destino de un viaje suyo (desde que se lo asignan hasta que lo finaliza).
  if new.chofer_id is not null and new.chofer_id = old.chofer_id and new.estado in ('ofrecido', 'asignado')
     and auth.uid() is distinct from new.chofer_id then
    if new.tipo is distinct from old.tipo then
      cambios := cambios || ('Ahora es ' || case when new.tipo = 'programado' then 'programado' else 'inmediato' end);
    end if;
    if new.tipo = 'programado' and new.hora_presentacion is distinct from old.hora_presentacion then
      cambios := cambios || ('Presentarse: ' || coalesce(public.texto_fecha_hora(old.hora_presentacion) || ' → ', '')
                             || public.texto_fecha_hora(new.hora_presentacion));
    end if;
    if new.tipo = 'programado' and new.hora_asignacion is distinct from old.hora_asignacion then
      cambios := cambios || ('Salir a hacerlo: ' || public.texto_fecha_hora(old.hora_asignacion) || ' → '
                             || public.texto_fecha_hora(new.hora_asignacion));
    end if;
    if new.origen is distinct from old.origen then
      cambios := cambios || ('Buscar en: ' || new.origen);
    end if;
    if new.destino is distinct from old.destino then
      cambios := cambios || ('Destino: ' || coalesce(new.destino, 'sin destino'));
    end if;
    if array_length(cambios, 1) > 0 then
      perform public.crear_aviso(new.id, new.chofer_id, '🔄 Cambió tu viaje',
        public.texto_cuando(new.tipo, new.hora_presentacion) || E'\n' || array_to_string(cambios, E'\n'),
        'cambio-' || new.id);
    end if;
  end if;
  return null;
end;
$$;

create trigger viajes_avisar_cambios
  after update on public.viajes
  for each row execute function public.viajes_avisar_cambios();
