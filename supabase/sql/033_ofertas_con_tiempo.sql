-- Vuelve el tiempo límite de las ofertas de la cola: 2 minutos y medio (decidido el 22/10/2026; reemplaza "sin tiempo
-- límite" del 28/9). Problema: si un chofer no contestaba, el viaje quedaba esperándolo y, si nadie estaba atento, sin hacer.
--   - Si el chofer no acepta ni rechaza en 2:30, el viaje pasa al siguiente de la cola y él sigue primero (igual que si
--     rechaza). Ese viaje no se le vuelve a ofrecer.
--   - Le suena "⌛ Se te pasó el viaje" (reemplaza al aviso de la oferta en el celular).
--   - Si no queda nadie en la cola, el viaje queda sin chofer: sale en el cartel rojo y les suena a los admins (030).
--   - Las asignaciones a mano de gestión siguen sin tiempo límite.
-- Lo revisan el servidor cada minuto y las apps abiertas cada 20 segundos (revisar_asignaciones).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

-- Igual que en 016, más: 1) vencer las ofertas de la cola que pasaron los 2:30; 2) las ofertas nuevas vencen a los 2:30.
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

  -- 1) Ofertas de la cola vencidas → el viaje vuelve a esperar (y se ofrece al siguiente en el paso 2).
  --    El chofer conserva su lugar en la cola.
  for v in
    select id, chofer_id, origen from public.viajes
    where estado = 'ofrecido' and asignado_por is null and oferta_vence is not null and oferta_vence < now()
    for update
  loop
    perform public.cerrar_oferta(v.id, 'vencida');
    update public.viajes
    set estado = 'sin_chofer', chofer_id = null, oferta_vence = null, asignado_en = null
    where id = v.id;
    perform public.crear_aviso(v.id, v.chofer_id, '⌛ Se te pasó el viaje',
      'Buscar en: ' || v.origen || E'\nNo contestaste a tiempo y pasó al siguiente de la cola. Seguís primero en la cola.',
      'viaje-' || v.id);
  end loop;

  -- 2) Viajes esperando, en orden de prioridad → primer chofer disponible de la cola.
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
      -- no se lo ofrecieron antes (lo rechazó o no contestó)
      and not exists (select 1 from public.ofertas f where f.viaje_id = v.id and f.chofer_id = c.id)
    order by c.anunciado_en
    limit 1
    for update of c;

    continue when not found;

    update public.viajes
    set estado = 'ofrecido', chofer_id = v_chofer, asignado_en = now(), asignado_por = null,
        oferta_vence = now() + interval '150 seconds'
    where id = v.id;

    insert into public.ofertas (viaje_id, chofer_id, tipo, vence)
    values (v.id, v_chofer, 'automatica', now() + interval '150 seconds');
  end loop;

  perform set_config('app.asignando', '', true);
end;
$$;
revoke execute on function public.asignar_pendientes() from public, anon, authenticated;

-- Las ofertas de la cola que están esperando ahora empiezan a contar desde ya.
update public.viajes set oferta_vence = now() + interval '150 seconds'
where estado = 'ofrecido' and asignado_por is null;
update public.ofertas set vence = now() + interval '150 seconds'
where resultado = 'pendiente' and tipo = 'automatica';

---------------------------------------------------------------------------
-- Aviso al chofer: cuando la oferta vence no le llega "Se anuló tu viaje" (le llega "Se te pasó el viaje", de arriba).
-- Igual que en 031, salvo que lo que hace asignar_pendientes (app.asignando) no cuenta como anulación.
---------------------------------------------------------------------------

create or replace function public.viajes_avisar_cambios()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cambios text[] := '{}';
begin
  -- Lo que hace el propio chofer (rechazar, finalizar…) no se le avisa.
  -- 3) Ya no es su viaje: tenía el viaje (ofrecido, aceptado o haciéndolo) y gestión lo anuló, se lo pasó a otro
  --    o lo dejó sin chofer. Para el chofer es el mismo aviso: "Se anuló tu viaje".
  --    (Si la oferta de la cola venció, el aviso es otro: lo manda asignar_pendientes.)
  if old.chofer_id is not null and old.estado in ('ofrecido', 'asignado') and auth.uid() is distinct from old.chofer_id
     and (new.estado = 'anulado' or new.chofer_id is distinct from old.chofer_id) then
    if coalesce(current_setting('app.asignando', true), '') <> '1' then
      perform public.crear_aviso(new.id, old.chofer_id, '❌ Se anuló tu viaje',
        public.texto_cuando(old.tipo, old.hora_presentacion) || E'\n' || public.texto_recorrido(old.origen, old.destino),
        'viaje-' || new.id);
    end if;
    return null;
  end if;

  -- 2) Cambió el horario, el origen o el destino de un viaje suyo (desde que se lo asignan hasta que lo finaliza),
  --    o se le agregó un adjunto.
  if new.chofer_id is not null and new.chofer_id = old.chofer_id and new.estado in ('ofrecido', 'asignado')
     and auth.uid() is distinct from new.chofer_id then
    if new.tipo is distinct from old.tipo then
      cambios := cambios || ('Ahora es ' || case when new.tipo = 'programado' then 'programado' else 'inmediato' end);
    end if;
    if new.tipo = 'programado' and new.hora_presentacion is distinct from old.hora_presentacion then
      cambios := cambios || ('Presentarse: ' || coalesce(public.texto_fecha_hora(old.hora_presentacion) || ' → ', '')
                             || public.texto_fecha_hora(new.hora_presentacion));
    end if;
    if new.tipo = 'programado' and new.hora_asignacion is distinct from old.hora_asignacion then
      cambios := cambios || ('Salir a hacerlo: ' || public.texto_fecha_hora(old.hora_asignacion) || ' → '
                             || public.texto_fecha_hora(new.hora_asignacion));
    end if;
    if new.origen is distinct from old.origen then
      cambios := cambios || ('Buscar en: ' || new.origen);
    end if;
    if new.destino is distinct from old.destino then
      cambios := cambios || ('Destino: ' || coalesce(new.destino, 'sin destino'));
    end if;
    if new.adjuntos is distinct from old.adjuntos then
      cambios := cambios || public.texto_adjuntos_nuevos(old.adjuntos, new.adjuntos);
    end if;
    if array_length(cambios, 1) > 0 then
      perform public.crear_aviso(new.id, new.chofer_id, '🔄 Cambió tu viaje',
        public.texto_cuando(new.tipo, new.hora_presentacion) || E'\n' || array_to_string(cambios, E'\n'),
        'cambio-' || new.id);
    end if;
  end if;
  return null;
end;
$$;
