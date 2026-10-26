-- Devolver un viaje (pedido del dueño, 26/10/2026): si a un chofer que ya tiene el viaje (aceptado o haciéndolo) se le
-- rompe el auto, lo devuelve y el viaje vuelve a la cola solo.
--   - Explica qué pasó escribiendo y/o con un audio grabado en la app (queda en las observaciones del viaje).
--   - Si ya estaba con el pasajero, dice dónde está: escribiéndolo y/o "📍 Está donde estoy yo" (la última ubicación de su
--     auto). Eso pasa a ser el nuevo "Buscar en" (el anterior queda anotado en las observaciones).
--   - El viaje vuelve a la cola como ⭐ prioritario. Al chofer que lo devolvió no se le vuelve a ofrecer, y queda Libre.
--   - A los admins les suena "⚠️ Juan devolvió el viaje" con lo que pasó.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

-- Los choferes suben sus audios a la carpeta privada "adjuntos", en su propia subcarpeta (chofer/<su id>/…).
create policy "chofer sube sus audios" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'adjuntos' and public.mi_rol() = 'chofer' and name like 'chofer/' || auth.uid()::text || '/%');

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

  -- El chofer queda Libre (fuera de la cola).
  update public.choferes
  set estado = 'libre', estado_desde = now(), anunciado_en = null, ultimo_reporte = now()
  where id = auth.uid() and estado <> 'fuera_de_servicio';

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
revoke execute on function public.devolver_viaje(bigint, text, jsonb, text, boolean) from public, anon;
