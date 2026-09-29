-- Notificaciones en la app Android (con Firebase), además de las del navegador.
-- Incluye un arreglo de los viajes fijos (el historial podía anotar dos veces "Creado solo por el viaje fijo").
-- Se ejecuta una sola vez en Supabase → SQL Editor.

-- Cada celular con la app: el "token" de Firebase al que se le mandan los avisos.
create table public.tokens_app (
  token     text primary key,
  perfil_id uuid not null references public.perfiles (id) on delete cascade,
  creado_en timestamptz not null default now()
);
alter table public.tokens_app enable row level security;  -- sin reglas: solo por las funciones de abajo

-- La app lo guarda al entrar (si el celular antes era de otro usuario, pasa a ser del actual).
create or replace function public.guardar_token_app(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.tokens_app (token, perfil_id)
  select p_token, auth.uid()
  where public.mi_rol() is not null and nullif(trim(p_token), '') is not null
  on conflict (token) do update set perfil_id = excluded.perfil_id, creado_en = now();
$$;
revoke execute on function public.guardar_token_app(text) from public, anon;

-- Al cerrar sesión, ese celular deja de recibir avisos.
create or replace function public.borrar_token_app(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.tokens_app where token = p_token and perfil_id = auth.uid();
$$;
revoke execute on function public.borrar_token_app(text) from public, anon;

---------------------------------------------------------------------------
-- Arreglo de viajes fijos: el número del viaje creado se limpia en cada día.
---------------------------------------------------------------------------

create or replace function public.crear_viajes_fijos(p_fijo bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.viajes_fijos;
  d date;
  pres timestamptz;
  nuevo bigint;
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  select * into f from public.viajes_fijos where id = p_fijo;
  if not found or not f.activo then return; end if;

  for d in select hoy + i from generate_series(0, 27) as i loop
    continue when not (extract(dow from d)::smallint = any (f.dias));
    pres := public.hora_argentina(d, f.hora);
    continue when pres <= now();

    nuevo := null;
    insert into public.viajes (tipo, cliente_nombre, cliente_telefono, origen, destino, observaciones,
                               hora_presentacion, hora_asignacion, creado_por,
                               viaje_fijo_id, fecha_fija, chofer_fijo, espera_gestion)
    values ('programado', f.cliente_nombre, f.cliente_telefono, f.origen, f.destino, f.observaciones,
            pres, pres - make_interval(mins => f.anticipacion), null,
            f.id, d, f.chofer_id, f.chofer_id is not null)
    on conflict (viaje_fijo_id, fecha_fija) do nothing
    returning id into nuevo;

    if nuevo is not null then
      perform public.registrar(nuevo, 'Creado solo por el viaje fijo #' || f.id, null);
    end if;
  end loop;
end;
$$;
revoke execute on function public.crear_viajes_fijos(bigint) from public, anon, authenticated;
