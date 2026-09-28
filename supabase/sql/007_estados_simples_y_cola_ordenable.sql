-- Cierre del Bloque B: 4 estados fijos (sin cambios automáticos) y cola ordenable.
-- Se ejecuta una sola vez en Supabase → SQL Editor.
--   fuera_de_servicio · libre · en_cola · en_viaje

-- 1) Sacar lo automático (desconexión por tiempo y configuración de minutos).
select cron.unschedule('desconectar-inactivos');
drop function if exists public.desconectar_inactivos();
drop table if exists public.configuracion;

-- 2) Nuevos estados.
alter table public.choferes drop constraint if exists choferes_estado_check;
update public.choferes set estado = 'fuera_de_servicio' where estado = 'desconectado';
update public.choferes set estado = 'libre' where estado in ('conectado', 'yendo');
alter table public.choferes
  alter column estado set default 'fuera_de_servicio',
  add constraint choferes_estado_check
    check (estado in ('fuera_de_servicio', 'libre', 'en_cola', 'en_viaje'));

-- 3) "Sigo con la app abierta": solo anota la hora, nunca cambia el estado.
create or replace function public.reportar_chofer()
returns public.choferes
language plpgsql
security definer
set search_path = public
as $$
declare
  fila public.choferes;
begin
  if public.mi_rol() is distinct from 'chofer' then raise exception 'Solo para choferes'; end if;
  update public.choferes set ultimo_reporte = now() where id = auth.uid() returning * into fila;
  return fila;
end;
$$;

-- 4) El chofer pasa a libre o fuera de servicio (si estaba en la cola, sale).
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
  if nuevo not in ('libre', 'fuera_de_servicio') then raise exception 'Estado no permitido'; end if;

  select * into fila from public.choferes where id = auth.uid() for update;
  if fila.estado = 'en_viaje' then raise exception 'Tenés un viaje sin finalizar. Primero finalizalo.'; end if;

  update public.choferes
  set estado = nuevo, estado_desde = now(), ultimo_reporte = now(), anunciado_en = null
  where id = auth.uid()
  returning * into fila;
  return fila;
end;
$$;

-- 5) Gestión pasa a un chofer a libre o fuera de servicio.
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
  if nuevo not in ('libre', 'fuera_de_servicio') then raise exception 'Estado no permitido'; end if;

  update public.choferes
  set estado = nuevo, estado_desde = now(), anunciado_en = null
  where id = chofer and estado <> 'en_viaje'
  returning * into fila;
  if not found then raise exception 'Tiene un viaje sin finalizar.'; end if;
  return fila;
end;
$$;

-- 6) Salir de la cola → libre.
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
  set estado = 'libre', estado_desde = now(), anunciado_en = null
  where id = quien and estado = 'en_cola'
  returning * into fila;

  if not found then select * into fila from public.choferes where id = quien; end if;
  return fila;
end;
$$;

-- 7) Si lo marcan como oculto estando en la cola, sale de la cola (queda libre).
create or replace function public.oculto_sale_de_cola()
returns trigger
language plpgsql
as $$
begin
  if new.oculto and new.estado = 'en_cola' then
    new.estado := 'libre';
    new.estado_desde := now();
    new.anunciado_en := null;
  end if;
  return new;
end;
$$;

-- 8) Mover a un chofer a otro puesto de la cola (arrastrar en gestión).
create or replace function public.mover_en_cola(chofer uuid, puesto int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  orden uuid[];
  base timestamptz;
  i int;
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'Solo para gestión'; end if;

  -- Bloquea la cola mientras se reordena.
  perform 1 from public.choferes where estado = 'en_cola' for update;

  select array_agg(id order by anunciado_en), min(anunciado_en)
  into orden, base
  from public.choferes where estado = 'en_cola';

  if orden is null or not (chofer = any (orden)) then raise exception 'Ese chofer no está en la cola.'; end if;

  orden := array_remove(orden, chofer);
  puesto := greatest(1, least(puesto, coalesce(array_length(orden, 1), 0) + 1));
  orden := orden[1:puesto - 1] || chofer || orden[puesto:];

  for i in 1 .. array_length(orden, 1) loop
    update public.choferes
    set anunciado_en = base + make_interval(secs => (i - 1) * 0.001)
    where id = orden[i];
  end loop;
end;
$$;
