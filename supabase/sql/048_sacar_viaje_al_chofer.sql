-- Sacarle el viaje a un chofer, aunque ya lo esté haciendo (pedido del 2/11/2026): gestión se lo pasa a otro chofer
-- o lo manda a la cola. Ej.: Martín está haciendo un viaje, sale otro que le quieren dar a él, y el primero lo hace otro.
--  - "↩️ Mandar a la cola": el viaje queda prioritario y se le ofrece al primero de la cola.
--  - Al chofer que lo tenía le llega "Se anuló tu viaje" y, si lo estaba haciendo, vuelve al puesto 1 de la cola (como
--    hasta ahora). Ese viaje no se le vuelve a ofrecer, ni le suena para tomarlo, ni lo puede tomar (gestión sí se lo puede
--    volver a asignar a mano).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

-- A quién le sacó gestión cada viaje. Solo la usan las funciones de la base: ningún chofer la puede leer (ningún chofer
-- puede saber quién hizo un viaje).
create table public.viajes_sacados (
  viaje_id  bigint not null references public.viajes(id) on update cascade on delete cascade,
  chofer_id uuid not null references public.perfiles(id) on delete cascade,
  sacado_en timestamptz not null default now(),
  primary key (viaje_id, chofer_id)
);
alter table public.viajes_sacados enable row level security;

-- A quién no se le ofrece un viaje: los de "No ofrecer a" y, desde ahora, a los que gestión se lo sacó. La usan la cola
-- (asignar_pendientes), el aviso "🆘 Viaje sin chofer", la lista de viajes para tomar y tomar_viaje.
create or replace function public.excluidos_vigentes(v public.viajes)
returns uuid[]
language sql
stable
as $$
  select v.choferes_excluidos
         || coalesce(array(select s.chofer_id from public.viajes_sacados s where s.viaje_id = v.id), '{}')
$$;

-- Asignar, cambiar o sacar el chofer de un viaje (gestión). Igual que antes, más: queda anotado a quién se le sacó.
create or replace function public.asignar_viaje(viaje bigint, chofer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'Solo para gestión'; end if;
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));

  select * into v from public.viajes where id = viaje for update;
  if not found then raise exception 'Viaje no encontrado'; end if;
  if v.estado not in ('sin_chofer', 'ofrecido', 'asignado') then raise exception 'Este viaje ya terminó.'; end if;
  if chofer is not null and not exists (
    select 1 from public.perfiles where id = chofer and rol = 'chofer' and activo) then
    raise exception 'Ese chofer no existe o está desactivado.';
  end if;

  -- Se lo saca al chofer que lo tenía: la cola no se lo vuelve a ofrecer (antes de cambiar el viaje, porque al quedar
  -- sin chofer la cola lo ofrece enseguida).
  if v.chofer_id is not null and chofer is distinct from v.chofer_id then
    insert into public.viajes_sacados (viaje_id, chofer_id) values (viaje, v.chofer_id) on conflict do nothing;
    if v.estado = 'asignado' then  -- (si era una oferta sin contestar, ya lo anota cerrar_oferta)
      perform public.registrar(viaje, 'Gestión le sacó el viaje a ' || public.nombre_de(v.chofer_id)
        || case when v.iniciado_en is not null then ' (lo estaba haciendo)' else '' end);
    end if;
  end if;

  perform public.cerrar_oferta(viaje, 'cancelada');

  if chofer is null then
    update public.viajes
    set estado = 'sin_chofer', chofer_id = null, asignado_en = null, asignado_por = null,
        oferta_vence = null, aceptado_en = null, iniciado_en = null, espera_gestion = false
    where id = viaje;
  else
    update public.viajes
    set estado = 'ofrecido', chofer_id = chofer, asignado_en = now(), asignado_por = auth.uid(),
        oferta_vence = null, aceptado_en = null, iniciado_en = null, espera_gestion = false
    where id = viaje;
    insert into public.ofertas (viaje_id, chofer_id, tipo) values (viaje, chofer, 'manual');
  end if;

  -- Si el chofer anterior ya lo estaba haciendo, vuelve al puesto 1.
  if v.iniciado_en is not null and v.chofer_id is not null then
    perform public.devolver_chofer_a_la_cola(v.chofer_id);
  end if;

  perform public.asignar_pendientes();
end;
$$;

-- "↩️ Mandar a la cola": le saca el viaje al chofer y lo ofrece a la cola, como prioritario.
create or replace function public.mandar_a_la_cola(p_viaje bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'Solo para gestión'; end if;
  if not exists (select 1 from public.viajes
                 where id = p_viaje and chofer_id is not null and estado in ('ofrecido', 'asignado')) then
    raise exception 'Este viaje ya no tiene chofer: recargá la pantalla.';
  end if;
  update public.viajes set prioritario = true where id = p_viaje and not prioritario;
  perform public.asignar_viaje(p_viaje, null);
end;
$$;
revoke execute on function public.mandar_a_la_cola(bigint) from public, anon;
grant execute on function public.mandar_a_la_cola(bigint) to authenticated;
