-- Cada usuario elige su propia contraseña: el admin crea el usuario con una contraseña provisoria
-- y la primera vez que entra, la app lo obliga a elegir una nueva (que el admin no sabe).
-- Lo mismo cuando el admin le pone una contraseña nueva (ej. porque se la olvidó).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

alter table public.perfiles add column debe_cambiar_clave boolean not null default false;

-- Los choferes que ya están creados también la tienen que cambiar la próxima vez que entren.
update public.perfiles set debe_cambiar_clave = true where rol = 'chofer';

-- La llama la app después de que el usuario eligió su contraseña.
create or replace function public.clave_cambiada()
returns void
language sql
security definer
set search_path = public
as $$
  update public.perfiles set debe_cambiar_clave = false where id = auth.uid();
$$;
revoke execute on function public.clave_cambiada() from public, anon;
