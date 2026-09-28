-- Tarea 3: perfiles y roles.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

create table public.perfiles (
  id        uuid primary key references auth.users (id) on delete cascade,
  rol       text not null check (rol in ('admin', 'operador', 'chofer')),
  nombre    text not null,
  telefono  text,
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Rol del usuario que está usando la app (lo usan las reglas de seguridad).
create or replace function public.mi_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.perfiles where id = auth.uid() and activo
$$;

alter table public.perfiles enable row level security;

-- Cada uno ve su propio perfil; admin y operadores ven todos.
create policy "ver perfiles" on public.perfiles
  for select to authenticated
  using (id = auth.uid() or public.mi_rol() in ('admin', 'operador'));

-- Solo el admin crea, cambia o borra perfiles (nadie puede cambiarse el rol a sí mismo).
create policy "admin gestiona perfiles" on public.perfiles
  for all to authenticated
  using (public.mi_rol() = 'admin')
  with check (public.mi_rol() = 'admin');

-- El usuario que ya existe (el tuyo) queda como admin.
insert into public.perfiles (id, rol, nombre)
select id, 'admin', 'Administrador' from auth.users
on conflict (id) do nothing;
