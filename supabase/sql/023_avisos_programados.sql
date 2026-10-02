-- Viajes programados: aviso al chofer cuando llega la hora de salir (hora de asignación).
-- Le suena aunque esté fuera de servicio. Lo manda la función "notificar" (app y navegador).
-- ⚠️ Antes de correr esto, subir la versión nueva de la función "notificar"
--    (si no, la función vieja ignora estos avisos y se pierden).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

alter table public.viajes
  add column aviso_salida_en            timestamptz,  -- cuándo el servidor decidió avisar
  add column aviso_salida_notificado_en timestamptz;  -- cuándo la función mandó el aviso (evita duplicados)

-- Si gestión cambia la hora o el chofer, se vuelve a avisar a la hora nueva (o al chofer nuevo).
create or replace function public.viajes_reiniciar_aviso()
returns trigger
language plpgsql
as $$
begin
  if new.hora_asignacion is distinct from old.hora_asignacion or new.chofer_id is distinct from old.chofer_id then
    new.aviso_salida_en := null;
    new.aviso_salida_notificado_en := null;
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
  v record;
begin
  for v in
    select id, chofer_id from public.viajes
    where estado = 'asignado' and iniciado_en is null and aviso_salida_en is null
      and hora_asignacion <= now() and hora_asignacion > now() - interval '2 hours'
    for update skip locked
  loop
    update public.viajes set aviso_salida_en = now() where id = v.id;
    perform public.registrar(v.id, 'Se le avisó a ' || public.nombre_de(v.chofer_id) || ' que es hora de salir', null);
    perform net.http_post(
      url := 'https://yomjqdbaatydpvazkvvg.supabase.co/functions/v1/notificar',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvbWpxZGJhYXR5ZHB2YXprdnZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MDAzODUsImV4cCI6MjEwNjE3NjM4NX0.7qNU5RVjZ-am6wg5qXf9J85wikDHstVemt8fJaoOca4'
      ),
      body := jsonb_build_object('viaje_id', v.id, 'aviso', 'hora_de_salir')
    );
  end loop;
end;
$$;
revoke execute on function public.avisar_hora_de_salir() from public, anon, authenticated;

select cron.schedule('aviso-hora-de-salir', '* * * * *', 'select public.avisar_hora_de_salir()');
