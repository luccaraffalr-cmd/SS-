-- Ofertas automáticas sin tiempo límite, y el que rechaza queda primero en la cola (decidido 28/9/2026).
--   * La oferta queda esperando hasta que el chofer acepte o rechace (gestión la puede reasignar).
--   * Rechaza → el viaje pasa al siguiente; él sigue primero en la cola (no se le vuelve a ofrecer ese viaje).
-- Desde ahora, "oferta automática" = ofrecido sin asignado_por (antes se usaba oferta_vence).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

update public.viajes set oferta_vence = null where estado = 'ofrecido';
update public.ofertas set vence = null where resultado = 'pendiente';

create or replace function public.asignar_pendientes()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_chofer uuid;
begin
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));
  perform set_config('app.asignando', '1', true);

  -- Viajes esperando, en orden de prioridad → primer chofer disponible de la cola.
  for v in
    select id from public.viajes
    where estado = 'sin_chofer' and not espera_gestion and hora_asignacion <= now()
    order by prioritario desc, (tipo = 'programado') desc, hora_asignacion, id
    for update
  loop
    select c.id into v_chofer
    from public.choferes c
    where c.estado = 'en_cola' and not c.oculto
      -- no tiene otra oferta automática esperando respuesta
      and not exists (select 1 from public.viajes o
                      where o.chofer_id = c.id and o.estado = 'ofrecido' and o.asignado_por is null)
      -- no le llegó la hora de un viaje que ya aceptó (tiene que salir a hacerlo)
      and not exists (select 1 from public.viajes a
                      where a.chofer_id = c.id and a.estado = 'asignado'
                        and a.iniciado_en is null and a.hora_asignacion <= now())
      -- no se lo ofrecieron antes (lo rechazó)
      and not exists (select 1 from public.ofertas f where f.viaje_id = v.id and f.chofer_id = c.id)
    order by c.anunciado_en
    limit 1
    for update of c;

    continue when not found;

    update public.viajes
    set estado = 'ofrecido', chofer_id = v_chofer, asignado_en = now(), asignado_por = null, oferta_vence = null
    where id = v.id;

    insert into public.ofertas (viaje_id, chofer_id, tipo) values (v.id, v_chofer, 'automatica');
  end loop;

  perform set_config('app.asignando', '', true);
end;
$$;
revoke execute on function public.asignar_pendientes() from public, anon, authenticated;

-- Aceptar. Oferta automática: sale a hacerlo en el momento. Manual: queda aceptado.
create or replace function public.aceptar_viaje(viaje bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
begin
  if public.mi_rol() is distinct from 'chofer' then raise exception 'Solo para choferes'; end if;
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));

  select * into v from public.viajes where id = viaje for update;
  if not found or v.estado <> 'ofrecido' or v.chofer_id is distinct from auth.uid() then
    raise exception 'Este viaje ya no está disponible para vos.';
  end if;

  perform public.cerrar_oferta(viaje, 'aceptada');
  update public.viajes set estado = 'asignado', aceptado_en = now() where id = viaje;
  update public.choferes set ultimo_reporte = now() where id = auth.uid();

  if v.asignado_por is null then
    perform public.iniciar_viaje_interno(viaje, auth.uid());
  end if;
end;
$$;

-- Rechazar. Automática: el viaje pasa al siguiente y el chofer sigue primero en la cola.
-- Manual: el viaje vuelve a gestión.
create or replace function public.rechazar_viaje(viaje bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
begin
  if public.mi_rol() is distinct from 'chofer' then raise exception 'Solo para choferes'; end if;
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));

  select * into v from public.viajes where id = viaje for update;
  if not found or v.estado <> 'ofrecido' or v.chofer_id is distinct from auth.uid() then
    raise exception 'Este viaje ya no está disponible para vos.';
  end if;

  perform public.cerrar_oferta(viaje, 'rechazada');
  update public.choferes set ultimo_reporte = now() where id = auth.uid();

  if v.asignado_por is null then
    update public.viajes
    set estado = 'sin_chofer', chofer_id = null, asignado_en = null, rechazado_por = auth.uid()
    where id = viaje;  -- el disparador lo ofrece al siguiente
  else
    update public.viajes
    set estado = 'sin_chofer', chofer_id = null, asignado_en = null, asignado_por = null,
        espera_gestion = true, rechazado_por = auth.uid()
    where id = viaje;
  end if;
end;
$$;

-- Choferes: viajes sin chofer (o con una oferta automática que nadie aceptó todavía).
create or replace function public.viajes_esperando()
returns table (id bigint, estado text, tipo text, hora_presentacion timestamptz, hora_asignacion timestamptz,
               origen text, destino text)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.estado, v.tipo, v.hora_presentacion, v.hora_asignacion,
         case when v.hora_asignacion <= now() then v.origen end,
         case when v.hora_asignacion <= now() then v.destino end
  from public.viajes v
  where public.mi_rol() is not null
    and (v.estado = 'sin_chofer' or (v.estado = 'ofrecido' and v.asignado_por is null))
    and v.hora_asignacion <= now() + interval '24 hours'
  order by v.hora_asignacion, v.id
$$;
