-- Ofertas de la cola: 1 minuto y 15 segundos para contestar (decidido el 3/11/2026; antes 2:30, SQL 033).
-- Si el chofer no acepta ni rechaza a tiempo, el viaje pasa al siguiente de la cola y él sigue primero (como antes).
-- No cambia: los viajes que asigna gestión a mano o con chofer fijo no tienen tiempo límite.
-- Es la misma función que está hoy en la base (asignar_pendientes), con 75 segundos en vez de 150.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

CREATE OR REPLACE FUNCTION public.asignar_pendientes()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v record;
  w public.viajes;
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

  -- 2) Viajes esperando, en orden de prioridad → primer chofer disponible de la cola (que no esté excluido).
  for w in
    select * from public.viajes
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
      and not exists (select 1 from public.ofertas f where f.viaje_id = w.id and f.chofer_id = c.id)
      -- el cliente no lo quiere (durante los primeros 2 minutos)
      and not (c.id = any (public.excluidos_vigentes(w)))
    order by c.anunciado_en
    limit 1
    for update of c;

    continue when not found;

    update public.viajes
    set estado = 'ofrecido', chofer_id = v_chofer, asignado_en = now(), asignado_por = null,
        oferta_vence = now() + interval '75 seconds'
    where id = w.id;

    insert into public.ofertas (viaje_id, chofer_id, tipo, vence)
    values (w.id, v_chofer, 'automatica', now() + interval '75 seconds');
  end loop;

  perform set_config('app.asignando', '', true);
end;
$function$;
