-- Tarea 4: guardar en el perfil el "usuario" con el que se entra a la app.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

alter table public.perfiles add column usuario text unique;

-- Los usuarios que ya existen usan su email como usuario.
update public.perfiles p
set usuario = lower(u.email)
from auth.users u
where u.id = p.id and p.usuario is null;
