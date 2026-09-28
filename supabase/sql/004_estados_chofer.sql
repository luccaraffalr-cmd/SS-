-- Tarea 6: estados del chofer (desconectado, conectado, yendo) y "último reporte".
-- Se ejecuta una sola vez en Supabase → SQL Editor.
-- "en_cola" y "en_viaje" se usan en las tareas de la cola y de los viajes.

alter table public.choferes
  add column estado text not null default 'desconectado'
    check (estado in ('desconectado', 'conectado', 'yendo', 'en_cola', 'en_viaje')),
  add column estado_desde timestamptz not null default now(),
  add column ultimo_reporte timestamptz;

-- El chofer avisa "sigo con la app abierta". Se llama al abrir la app y cada minuto.
-- Si estaba desconectado, pasa a conectado.
create or replace function public.reportar_chofer()
returns public.choferes
language plpgsql
security definer
set search_path = public
as $$
declare
  fila public.choferes;
begin
  if public.mi_rol() is distinct from 'chofer' then
    raise exception 'Solo para choferes';
  end if;

  update public.choferes
  set ultimo_reporte = now(),
      estado = case when estado = 'desconectado' then 'conectado' else estado end,
      estado_desde = case when estado = 'desconectado' then now() else estado_desde end
  where id = auth.uid()
  returning * into fila;

  return fila;
end;
$$;

-- El chofer cambia su propio estado: conectado, yendo o desconectado.
create or replace function public.cambiar_mi_estado(nuevo text)
returns public.choferes
language plpgsql
security definer
set search_path = public
as $$
declare
  fila public.choferes;
begin
  if public.mi_rol() is distinct from 'chofer' then
    raise exception 'Solo para choferes';
  end if;
  if nuevo not in ('conectado', 'yendo', 'desconectado') then
    raise exception 'Estado no permitido';
  end if;

  select * into fila from public.choferes where id = auth.uid() for update;
  if fila.estado = 'en_viaje' then
    raise exception 'Tenés un viaje sin finalizar. Primero finalizalo.';
  end if;

  update public.choferes
  set estado = nuevo, estado_desde = now(), ultimo_reporte = now()
  where id = auth.uid()
  returning * into fila;

  return fila;
end;
$$;

-- Gestión (admin u operador) cambia el estado de cualquier chofer.
create or replace function public.cambiar_estado_chofer(chofer uuid, nuevo text)
returns public.choferes
language plpgsql
security definer
set search_path = public
as $$
declare
  fila public.choferes;
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then
    raise exception 'Solo para gestión';
  end if;
  if nuevo not in ('conectado', 'yendo', 'desconectado') then
    raise exception 'Estado no permitido';
  end if;

  update public.choferes
  set estado = nuevo, estado_desde = now()
  where id = chofer
  returning * into fila;

  return fila;
end;
$$;

-- Que los cambios de los choferes lleguen al instante a las pantallas.
alter publication supabase_realtime add table public.choferes;
