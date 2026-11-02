-- Tomar un viaje estando en otro, ocultos que toman viajes y nadie sabe quién hizo cada viaje (pedidos del dueño, 27/10/2026).
--   - El chofer que está en viaje y toma un viaje sin chofer elige: "Lo hago ahora" (sale ya, sin terminar el otro; por
--     ejemplo, uno de pasada yendo a Ezeiza) o "Después" (le queda como próximo viaje, como hasta ahora). Un próximo viaje
--     también lo puede empezar cuando quiera. Como mucho 2 viajes andando a la vez. Columna choferes.dos_viajes (todos en
--     true): para sacárselo a alguno, update choferes set dos_viajes = false where ...
--   - Al finalizar o devolver uno de los dos, el chofer sigue "En viaje" con el otro.
--   - Los ocultos también pueden tomar los viajes sin chofer (y les suena el aviso). Siguen sin entrar en la cola.
--   - Ningún chofer puede saber quién hizo un viaje: "📣 Salió un viaje para Juan" ya no dice el cliente (ni el viaje).
-- Compatible con las pantallas publicadas antes: tomar_viaje sin "ahora" hace lo de siempre.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

alter table public.choferes add column dos_viajes boolean not null default true;

---------------------------------------------------------------------------
-- Empezar un viaje: con dos_viajes, aunque esté haciendo otro (hasta 2).
---------------------------------------------------------------------------

create or replace function public.iniciar_viaje_interno(p_viaje bigint, p_chofer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  andando integer;
begin
  select count(*) into andando from public.viajes
  where chofer_id = p_chofer and estado = 'asignado' and iniciado_en is not null and id <> p_viaje;
  if andando >= 2 then raise exception 'Ya estás haciendo 2 viajes: primero finalizá uno.'; end if;
  if andando = 1 and not coalesce((select dos_viajes from public.choferes where id = p_chofer), false) then
    raise exception 'Primero finalizá el viaje que estás haciendo.';
  end if;

  update public.viajes set iniciado_en = now() where id = p_viaje;
  update public.choferes
  set estado = 'en_viaje', estado_desde = case when estado = 'en_viaje' then estado_desde else now() end,
      anunciado_en = null, ultimo_reporte = now()
  where id = p_chofer;
end;
$$;
revoke execute on function public.iniciar_viaje_interno(bigint, uuid) from public, anon, authenticated;

---------------------------------------------------------------------------
-- Tomar un viaje sin chofer (igual que en 040, más los ocultos y "ahora").
---------------------------------------------------------------------------

drop function public.tomar_viaje(bigint);  -- cambia de parámetros (si no, quedarían dos y no se sabría cuál usar)

create function public.tomar_viaje(viaje bigint, ahora boolean default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
  c public.choferes;
begin
  if public.mi_rol() is distinct from 'chofer' then raise exception 'Solo para choferes'; end if;
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));

  select * into c from public.choferes where id = auth.uid() for update;
  if c.estado = 'fuera_de_servicio' then raise exception 'Para tomar un viaje, primero tocá "Empezar a trabajar".'; end if;
  if exists (select 1 from public.viajes o where o.chofer_id = auth.uid() and o.estado = 'ofrecido') then
    raise exception 'Primero aceptá o rechazá el viaje que te ofrecieron.';
  end if;

  select * into v from public.viajes where id = viaje for update;
  if not found or v.estado <> 'sin_chofer' then
    raise exception 'Este viaje ya lo tomó otro chofer o ya no está disponible.';
  end if;
  if auth.uid() = any (public.excluidos_vigentes(v)) then
    raise exception 'Este viaje no está disponible para vos.';
  end if;
  if public.tomar_desde(v) is null or public.tomar_desde(v) > now() then
    raise exception 'Este viaje todavía no se puede tomar.';
  end if;

  update public.viajes
  set estado = 'asignado', chofer_id = auth.uid(), asignado_en = now(), aceptado_en = now(), asignado_por = null,
      oferta_vence = null
  where id = viaje;
  update public.choferes set ultimo_reporte = now() where id = auth.uid();
  perform public.registrar(viaje, public.nombre_de(auth.uid()) || ' tomó el viaje desde la app');

  -- Libre o en la cola: sale a hacerlo ahora. En viaje: "Lo hago ahora" (ahora = true) o le queda como próximo viaje.
  if c.estado <> 'en_viaje' or ahora then
    perform public.iniciar_viaje_interno(viaje, auth.uid());
  end if;
end;
$$;
revoke execute on function public.tomar_viaje(bigint, boolean) from public, anon;
grant execute on function public.tomar_viaje(bigint, boolean) to authenticated;

---------------------------------------------------------------------------
-- Aviso "🆘 Viaje sin chofer" (igual que en 040): ahora también a los ocultos.
---------------------------------------------------------------------------

create or replace function public.avisar_viajes_para_tomar()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
  c record;
begin
  for v in
    select x.* from public.viajes x
    where x.estado = 'sin_chofer' and not x.espera_gestion and x.aviso_tomar_en is null
      and public.tomar_desde(x) <= now() and x.hora_asignacion > now() - interval '2 hours'
    for update of x skip locked
  loop
    update public.viajes set aviso_tomar_en = now() where id = v.id;
    for c in
      select ch.id from public.choferes ch join public.perfiles p on p.id = ch.id
      where ch.estado <> 'fuera_de_servicio' and p.activo and p.rol = 'chofer'
        and not (ch.id = any (public.excluidos_vigentes(v)))
    loop
      perform public.enviar_aviso(v.id, c.id, '🆘 Viaje sin chofer',
        public.texto_cuando(v.tipo, v.hora_presentacion) || E'\nBuscar en: ' || v.origen
          || coalesce(E'\nLlevar a: ' || v.destino, '')
          || E'\nEntrá a la app para tomarlo: el primero que lo toma se lo queda.',
        'tomar-' || v.id);
    end loop;
    for c in select id from public.perfiles where rol = 'admin' and activo loop
      perform public.enviar_aviso(v.id, c.id, '⚠️ Nadie tomó el viaje',
        public.texto_cuando(v.tipo, v.hora_presentacion)
          || coalesce(E'\nCliente: ' || v.cliente_nombre, '')
          || E'\nBuscar en: ' || v.origen || coalesce(E'\nLlevar a: ' || v.destino, '')
          || E'\nNadie de la cola lo tomó: ahora lo puede tomar cualquier chofer.',
        'alerta-' || v.id);
    end loop;
    perform public.registrar(v.id, 'Se liberó para todos los choferes (y se les avisó a los admins)', null);
  end loop;
end;
$$;
revoke execute on function public.avisar_viajes_para_tomar() from public, anon, authenticated;

---------------------------------------------------------------------------
-- Finalizar (igual que en 041): queda libre solo si no le queda otro viaje andando.
---------------------------------------------------------------------------

create or replace function public.finalizar_viaje(viaje bigint, opcion text, importe numeric default null,
  forma_pago text default null, motivo text default null, cuenta bigint default null, otro text default null,
  demora numeric default null, peaje numeric default null, nafta numeric default null, destino text default null)
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
  if not found or v.chofer_id is distinct from auth.uid() or v.estado <> 'asignado' or v.iniciado_en is null then
    raise exception 'Este viaje no está en curso.';
  end if;
  if opcion not in ('pago', 'despues', 'fallido') then raise exception 'Opción no válida'; end if;

  update public.viajes set finalizado_en = now() where id = viaje;

  if opcion = 'pago' then
    perform public.completar_destino(viaje, finalizar_viaje.destino);  -- antes del pago, así va a la planilla
    perform public.guardar_pago(viaje, importe, forma_pago, cuenta, otro, demora, peaje, nafta);
  elsif opcion = 'despues' then
    update public.viajes set estado = 'pago_pendiente' where id = viaje;
  else
    update public.viajes set estado = 'fallido', motivo_fallido = nullif(trim(motivo), '') where id = viaje;
  end if;

  update public.choferes set ultimo_reporte = now() where id = auth.uid();

  if opcion = 'fallido' then
    perform public.devolver_chofer_a_la_cola(auth.uid());  -- si sigue con otro viaje, no hace nada
    perform public.asignar_pendientes();
  else
    update public.choferes
    set estado = 'libre', estado_desde = now(), anunciado_en = null
    where id = auth.uid() and estado = 'en_viaje'
      and not exists (select 1 from public.viajes o
                      where o.chofer_id = auth.uid() and o.estado = 'asignado' and o.iniciado_en is not null
                        and o.id <> finalizar_viaje.viaje);
  end if;
end;
$$;

---------------------------------------------------------------------------
-- Devolver un viaje (igual que en 042): queda libre solo si no le queda otro viaje andando.
---------------------------------------------------------------------------

create or replace function public.devolver_viaje(p_viaje bigint, p_motivo text default null, p_audio jsonb default null,
  p_donde text default null, p_aca boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
  u public.ubicaciones;
  yo text := public.nombre_de(auth.uid());
  motivo text := nullif(trim(p_motivo), '');
  donde text := nullif(trim(p_donde), '');
  con_pasajero boolean;
  nota text;
  nuevo_origen text;
  nuevos_adjuntos jsonb;
  a record;
begin
  if public.mi_rol() is distinct from 'chofer' then raise exception 'Solo para choferes'; end if;
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));

  select * into v from public.viajes where id = p_viaje for update;
  if not found or v.chofer_id is distinct from auth.uid() or v.estado <> 'asignado' then
    raise exception 'Este viaje ya no es tuyo.';
  end if;
  if motivo is null and p_audio is null then raise exception 'Contá qué pasó (escribilo o grabá un audio).'; end if;
  if p_audio is not null and coalesce(p_audio->>'ruta', '') not like 'chofer/' || auth.uid()::text || '/%' then
    raise exception 'Audio no válido.';
  end if;
  con_pasajero := v.iniciado_en is not null;

  -- Dónde buscar al pasajero ahora (solo si ya lo estaba haciendo).
  nuevo_origen := v.origen;
  nuevos_adjuntos := v.adjuntos;
  if con_pasajero and (donde is not null or p_aca) then
    nuevo_origen := coalesce(donde, 'Donde quedó el auto de ' || yo || ' (ver 📍)');
    -- Los adjuntos del origen anterior ya no sirven (eran del lugar viejo).
    nuevos_adjuntos := coalesce((select jsonb_agg(x) from jsonb_array_elements(v.adjuntos) x where x->>'campo' <> 'origen'), '[]');
    if p_aca then
      select * into u from public.ubicaciones where chofer_id = auth.uid();
      if found then
        nuevos_adjuntos := nuevos_adjuntos || jsonb_build_array(jsonb_build_object(
          'id', gen_random_uuid()::text, 'campo', 'origen', 'tipo', 'ubicacion', 'nombre', 'Donde está el pasajero',
          'url', 'https://www.google.com/maps/search/?api=1&query=' || u.lat || ',' || u.lon));
      end if;
    end if;
  end if;
  if p_audio is not null then
    nuevos_adjuntos := nuevos_adjuntos || jsonb_build_array(p_audio || jsonb_build_object('campo', 'observaciones'));
  end if;

  nota := '⚠️ ' || yo || ' devolvió el viaje (' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') || ')'
    || coalesce(': ' || motivo, case when p_audio is not null then ' (escuchá el audio)' else '' end)
    || case when nuevo_origen is distinct from v.origen then E'\nAntes había que buscarlo en: ' || v.origen else '' end;

  update public.viajes
  set estado = 'sin_chofer', chofer_id = null, asignado_en = null, aceptado_en = null, iniciado_en = null,
      asignado_por = null, espera_gestion = false, oferta_vence = null, prioritario = true,
      origen = nuevo_origen, adjuntos = nuevos_adjuntos,
      observaciones = concat_ws(E'\n', nullif(v.observaciones, ''), nota)
  where id = p_viaje;  -- el disparador lo ofrece al primero de la cola

  -- El chofer queda Libre (fuera de la cola), salvo que siga haciendo otro viaje.
  update public.choferes
  set estado = 'libre', estado_desde = now(), anunciado_en = null, ultimo_reporte = now()
  where id = auth.uid() and estado <> 'fuera_de_servicio'
    and not exists (select 1 from public.viajes o
                    where o.chofer_id = auth.uid() and o.estado = 'asignado' and o.iniciado_en is not null
                      and o.id <> p_viaje);

  perform public.registrar(p_viaje, yo || ' devolvió el viaje' || coalesce(': ' || motivo, ''));

  for a in select id from public.perfiles where rol = 'admin' and activo loop
    perform public.enviar_aviso(p_viaje, a.id, '⚠️ ' || yo || ' devolvió el viaje',
      public.texto_cuando(v.tipo, v.hora_presentacion)
        || coalesce(E'\nCliente: ' || v.cliente_nombre, '')
        || E'\nQué pasó: ' || coalesce(motivo, 'grabó un audio (está en el viaje)')
        || E'\nBuscar en: ' || nuevo_origen
        || E'\nVuelve a la cola como prioritario.',
      'alerta-' || p_viaje);
  end loop;
end;
$$;

---------------------------------------------------------------------------
-- "📣 Salió un viaje para Juan" (igual que en 029): sin el cliente ni el número de viaje.
---------------------------------------------------------------------------

drop function public.ofertas_en_curso();  -- cambian las columnas

create function public.ofertas_en_curso()
returns table (chofer_id uuid, chofer text, desde timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select v.chofer_id, p.nombre, o.creada_en
  from public.viajes v
  join public.perfiles p on p.id = v.chofer_id
  join public.ofertas o on o.viaje_id = v.id and o.chofer_id = v.chofer_id and o.resultado = 'pendiente'
  where public.mi_rol() is not null
    and v.estado = 'ofrecido' and v.asignado_por is null  -- ofrecido por la cola (no asignado a mano por gestión)
  order by o.creada_en
$$;
revoke execute on function public.ofertas_en_curso() from public, anon;
grant execute on function public.ofertas_en_curso() to authenticated;
