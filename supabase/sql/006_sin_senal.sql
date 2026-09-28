-- Tarea 8: alerta "sin señal" y desconexión automática.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

-- Configuración general de la app (una sola fila).
create table public.configuracion (
  id                 int primary key default 1 check (id = 1),
  minutos_sin_senal  int not null default 5 check (minutos_sin_senal between 1 and 120)
);
insert into public.configuracion (id) values (1);

alter table public.configuracion enable row level security;

create policy "todos leen la configuracion" on public.configuracion
  for select to authenticated using (true);

create policy "admin cambia la configuracion" on public.configuracion
  for update to authenticated
  using (public.mi_rol() = 'admin')
  with check (public.mi_rol() = 'admin');

-- Cada minuto, en el servidor: el chofer que estaba solo "conectado" (no trabajando)
-- y dejó de reportar, pasa a "desconectado". A los que están trabajando no se les
-- cambia el estado: gestión ve la alerta "sin señal".
create extension if not exists pg_cron;

create or replace function public.desconectar_inactivos()
returns void
language sql
security definer
set search_path = public
as $$
  update public.choferes
  set estado = 'desconectado', estado_desde = now()
  where estado = 'conectado'
    and greatest(ultimo_reporte, estado_desde) <
        now() - make_interval(mins => (select minutos_sin_senal from public.configuracion where id = 1));
$$;
revoke execute on function public.desconectar_inactivos() from public, anon, authenticated;

select cron.schedule('desconectar-inactivos', '* * * * *', 'select public.desconectar_inactivos()');

alter publication supabase_realtime add table public.configuracion;
