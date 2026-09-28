-- Tarea 15: notificaciones push (con sonido) al celular del chofer cuando le ofrecen o asignan un viaje.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

-- Cada celular donde el chofer activó las notificaciones.
create table public.push_suscripciones (
  id        bigint generated always as identity primary key,
  perfil_id uuid not null references public.perfiles (id) on delete cascade,
  endpoint  text not null unique,
  p256dh    text not null,
  auth      text not null,
  creado_en timestamptz not null default now()
);

alter table public.push_suscripciones enable row level security;

create policy "cada uno ve sus suscripciones" on public.push_suscripciones
  for select to authenticated using (perfil_id = auth.uid());
create policy "cada uno agrega sus suscripciones" on public.push_suscripciones
  for insert to authenticated with check (perfil_id = auth.uid());
create policy "cada uno borra sus suscripciones" on public.push_suscripciones
  for delete to authenticated using (perfil_id = auth.uid());

-- Guarda la suscripción del celular a nombre de quien está usando la app.
-- (Si el celular antes era de otro usuario, pasa a ser del actual.)
create or replace function public.guardar_suscripcion(p_endpoint text, p_p256dh text, p_auth text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.push_suscripciones (perfil_id, endpoint, p256dh, auth)
  select auth.uid(), p_endpoint, p_p256dh, p_auth
  where public.mi_rol() is not null
  on conflict (endpoint) do update
    set perfil_id = excluded.perfil_id, p256dh = excluded.p256dh, auth = excluded.auth, creado_en = now();
$$;

-- Para no mandar dos veces la misma notificación.
alter table public.ofertas add column notificada_en timestamptz;

-- Cuando se crea una oferta, se le pide a la función "notificar" que mande la notificación.
-- (pg_net hace el pedido en segundo plano, después de guardar.)
-- La función solo notifica ofertas recién creadas y todavía no notificadas, así que
-- la clave pública (anon) alcanza para llamarla sin riesgo.
create extension if not exists pg_net;

create or replace function public.oferta_notificar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://yomjqdbaatydpvazkvvg.supabase.co/functions/v1/notificar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvbWpxZGJhYXR5ZHB2YXprdnZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MDAzODUsImV4cCI6MjEwNjE3NjM4NX0.7qNU5RVjZ-am6wg5qXf9J85wikDHstVemt8fJaoOca4'
    ),
    body := jsonb_build_object('oferta_id', new.id)
  );
  return null;
end;
$$;

create trigger ofertas_notificar
  after insert on public.ofertas
  for each row execute function public.oferta_notificar();
