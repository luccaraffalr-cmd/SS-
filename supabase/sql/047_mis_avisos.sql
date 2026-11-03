-- "Mis avisos" (pedido del 2/11/2026): cada uno (choferes y gestión) elige qué avisos le suenan. Los que pone sin sonido
-- le llegan igual al celular, pero callados. Los de sus propios viajes ("Viaje para vos", "Gestión te asignó un viaje" y
-- "Es hora de salir") suenan siempre: no se pueden poner sin sonido.
-- La función "notificar" mira esta lista antes de mandar cada aviso.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

alter table public.perfiles add column avisos_sin_sonido text[] not null default '{}';

-- Guarda los avisos que van sin sonido para quien está usando la app (solo los que se pueden elegir).
create or replace function public.guardar_avisos_sin_sonido(p_tipos text[])
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  elegidos text[];
begin
  if auth.uid() is null then raise exception 'No permitido'; end if;
  elegidos := array(
    select distinct t from unnest(coalesce(p_tipos, '{}')) as t
    where t in ('cambio', 'anulado', 'se_paso', 'para_tomar', 'salio', 'nadie_tomo', 'sin_chofer', 'devolvio'));
  update public.perfiles set avisos_sin_sonido = elegidos where id = auth.uid();
  return elegidos;
end;
$$;
revoke execute on function public.guardar_avisos_sin_sonido(text[]) from public, anon;
grant execute on function public.guardar_avisos_sin_sonido(text[]) to authenticated;
