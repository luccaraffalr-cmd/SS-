-- Tarea 7: cola de choferes.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

-- Momento en que se anunció. La cola se ordena por esto (el más antiguo es el puesto 1).
alter table public.choferes add column anunciado_en timestamptz;

-- Los choferes ven a los demás choferes no ocultos (para ver la cola, quién va y quién está en viaje).
create policy "choferes ven a sus compañeros" on public.choferes
  for select to authenticated
  using (public.mi_rol() = 'chofer' and not oculto);

create or replace function public.es_chofer_visible(persona uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.choferes where id = persona and not oculto)
$$;

create policy "choferes ven nombres de compañeros" on public.perfiles
  for select to authenticated
  using (public.mi_rol() = 'chofer' and rol = 'chofer' and activo and public.es_chofer_visible(id));

-- Pone a un chofer al final de la cola (lo usan "Anunciarse" y "Agregar a la cola").
create or replace function public.poner_en_cola(chofer uuid)
returns public.choferes
language plpgsql
security definer
set search_path = public
as $$
declare
  fila public.choferes;
begin
  select * into fila from public.choferes where id = chofer for update;
  if not found then raise exception 'Chofer no encontrado'; end if;
  if fila.oculto then raise exception 'Los choferes ocultos no entran en la cola.'; end if;
  if fila.estado = 'en_viaje' then raise exception 'Tiene un viaje sin finalizar.'; end if;
  if fila.estado = 'en_cola' then return fila; end if;

  update public.choferes
  set estado = 'en_cola', estado_desde = now(), anunciado_en = clock_timestamp()
  where id = chofer
  returning * into fila;
  return fila;
end;
$$;
revoke execute on function public.poner_en_cola(uuid) from public, anon, authenticated;

-- El chofer toca "Anunciarse".
create or replace function public.anunciarme()
returns public.choferes
language plpgsql
security definer
set search_path = public
as $$
declare
  fila public.choferes;
begin
  if public.mi_rol() is distinct from 'chofer' then raise exception 'Solo para choferes'; end if;
  fila := public.poner_en_cola(auth.uid());
  update public.choferes set ultimo_reporte = now() where id = auth.uid() returning * into fila;
  return fila;
end;
$$;

-- Gestión toca "Agregar a la cola".
create or replace function public.agregar_a_cola(chofer uuid)
returns public.choferes
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'Solo para gestión'; end if;
  return public.poner_en_cola(chofer);
end;
$$;

-- Salir de la cola: vuelve a "conectado". Lo usan el chofer ("Darme de baja") y gestión ("Sacar").
create or replace function public.salir_de_cola(chofer uuid default null)
returns public.choferes
language plpgsql
security definer
set search_path = public
as $$
declare
  fila public.choferes;
  quien uuid := coalesce(chofer, auth.uid());
begin
  if not (coalesce(public.mi_rol(), '') in ('admin', 'operador') or (public.mi_rol() = 'chofer' and quien = auth.uid())) then
    raise exception 'No permitido';
  end if;

  update public.choferes
  set estado = 'conectado', estado_desde = now(), anunciado_en = null
  where id = quien and estado = 'en_cola'
  returning * into fila;

  if not found then select * into fila from public.choferes where id = quien; end if;
  return fila;
end;
$$;

-- Al cambiar de estado por los botones, si estaba en la cola, sale de la cola.
create or replace function public.cambiar_mi_estado(nuevo text)
returns public.choferes
language plpgsql
security definer
set search_path = public
as $$
declare
  fila public.choferes;
begin
  if public.mi_rol() is distinct from 'chofer' then raise exception 'Solo para choferes'; end if;
  if nuevo not in ('conectado', 'yendo', 'desconectado') then raise exception 'Estado no permitido'; end if;

  select * into fila from public.choferes where id = auth.uid() for update;
  if fila.estado = 'en_viaje' then
    raise exception 'Tenés un viaje sin finalizar. Primero finalizalo.';
  end if;

  update public.choferes
  set estado = nuevo, estado_desde = now(), ultimo_reporte = now(), anunciado_en = null
  where id = auth.uid()
  returning * into fila;
  return fila;
end;
$$;

create or replace function public.cambiar_estado_chofer(chofer uuid, nuevo text)
returns public.choferes
language plpgsql
security definer
set search_path = public
as $$
declare
  fila public.choferes;
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'Solo para gestión'; end if;
  if nuevo not in ('conectado', 'yendo', 'desconectado') then raise exception 'Estado no permitido'; end if;

  update public.choferes
  set estado = nuevo, estado_desde = now(), anunciado_en = null
  where id = chofer
  returning * into fila;
  return fila;
end;
$$;

-- Si a un chofer que está en la cola lo marcan como oculto, sale de la cola.
create or replace function public.oculto_sale_de_cola()
returns trigger
language plpgsql
as $$
begin
  if new.oculto and new.estado = 'en_cola' then
    new.estado := 'conectado';
    new.estado_desde := now();
    new.anunciado_en := null;
  end if;
  return new;
end;
$$;

create trigger choferes_oculto_sale_de_cola
  before update of oculto on public.choferes
  for each row execute function public.oculto_sale_de_cola();
