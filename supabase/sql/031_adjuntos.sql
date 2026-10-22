-- Adjuntos en los viajes (decidido el 22/10/2026, pedido del dueño): links (ej. la autorización del country), ubicaciones,
-- fotos, audios y archivos, pegados a una parte del viaje: Origen ("Buscar en"), Destino u Observaciones. Así, si el cliente
-- manda dos ubicaciones, una va al origen y otra al destino.
--   - Los carga gestión. Los ve el chofer de ese viaje (desde la oferta); los otros choferes y el pasajero, nunca.
--   - Lo que se carga en un viaje fijo (o en una serie) queda en todos sus viajes.
--   - Si gestión le agrega algo a un viaje que el chofer ya tiene, le llega "🔄 Cambió tu viaje" con lo que se agregó.
-- Cada adjunto es un objeto en la lista "adjuntos" del viaje:
--   { id, campo: 'origen'|'destino'|'observaciones', tipo: 'ubicacion'|'link'|'foto'|'audio'|'archivo',
--     url (link o ubicación), ruta (foto, audio o archivo: en la carpeta privada "adjuntos"), nombre (opcional) }
-- Se ejecuta una sola vez en Supabase → SQL Editor.

alter table public.viajes add column adjuntos jsonb not null default '[]';
alter table public.viajes_fijos add column adjuntos jsonb not null default '[]';

---------------------------------------------------------------------------
-- Carpeta privada para fotos, audios y archivos. Sube gestión; ve gestión y el chofer del viaje que lo tiene.
---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit) values ('adjuntos', 'adjuntos', false, 26214400)
on conflict (id) do nothing;

create policy "gestion sube adjuntos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'adjuntos' and public.mi_rol() in ('admin', 'operador'));

create policy "gestion y el chofer del viaje ven adjuntos" on storage.objects
  for select to authenticated
  using (bucket_id = 'adjuntos' and (
    public.mi_rol() in ('admin', 'operador')
    or exists (select 1 from public.viajes v
               where v.chofer_id = auth.uid() and v.adjuntos @> jsonb_build_array(jsonb_build_object('ruta', objects.name)))));

create policy "gestion borra adjuntos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'adjuntos' and public.mi_rol() in ('admin', 'operador'));

---------------------------------------------------------------------------
-- Viajes fijos y series: los adjuntos se copian a cada viaje (igual que el origen, el destino, etc.).
---------------------------------------------------------------------------

-- Cambiar los adjuntos de un día suelto también cuenta como "cambiado a mano" (igual que en 019, más adjuntos).
create or replace function public.viajes_marcar_editado()
returns trigger
language plpgsql
as $$
begin
  -- Si gestión cambia o anula un día suelto, ese día ya no se actualiza con el viaje fijo.
  if new.viaje_fijo_id is not null and coalesce(current_setting('app.sincronizando_fijo', true), '') <> '1'
     and ((new.origen, new.destino, new.cliente_nombre, new.cliente_telefono, new.observaciones,
           new.tipo, new.hora_presentacion, new.hora_asignacion, new.adjuntos)
          is distinct from
          (old.origen, old.destino, old.cliente_nombre, old.cliente_telefono, old.observaciones,
           old.tipo, old.hora_presentacion, old.hora_asignacion, old.adjuntos)
          or (new.estado = 'anulado' and old.estado <> 'anulado')) then
    new.editado_a_mano := true;
  end if;
  -- Si gestión le asigna otro chofer o lo pasa a la cola, deja de esperar al chofer fijo.
  if new.chofer_fijo is not null and (new.chofer_id is not null or not new.espera_gestion) then
    new.chofer_fijo := null;
  end if;
  return new;
end;
$$;

-- Igual que en 027, copiando también los adjuntos.
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

  for d in
    select x from unnest(coalesce(f.fechas, '{}'::date[])) as x where x >= hoy
    union
    select hoy + i from generate_series(0, 27) as i where f.fechas is null
    order by 1
  loop
    continue when not public.fijo_corresponde(f, d);
    -- Ya existe (aunque esté anulado): no se intenta, así no se gasta un número de viaje.
    continue when exists (select 1 from public.viajes where viaje_fijo_id = f.id and fecha_fija = d);
    pres := public.hora_argentina(d, f.hora);
    continue when pres <= now();

    nuevo := null;
    insert into public.viajes (tipo, cliente_nombre, cliente_telefono, origen, destino, observaciones, adjuntos,
                               hora_presentacion, hora_asignacion, creado_por,
                               viaje_fijo_id, fecha_fija, chofer_fijo, espera_gestion)
    values ('programado', f.cliente_nombre, f.cliente_telefono, f.origen, f.destino, f.observaciones, f.adjuntos,
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

-- Igual que en 026, copiando también los adjuntos.
create or replace function public.sincronizar_viaje_fijo(p_fijo bigint, p_borrando boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.viajes_fijos;
  v public.viajes;
  pres timestamptz;
  nunca_ofrecido boolean;
begin
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));
  perform set_config('app.sincronizando_fijo', '1', true);
  select * into f from public.viajes_fijos where id = p_fijo;

  for v in
    select * from public.viajes
    where viaje_fijo_id = p_fijo and not editado_a_mano and iniciado_en is null
      and estado in ('sin_chofer', 'ofrecido', 'asignado') and hora_presentacion > now()
    for update
  loop
    nunca_ofrecido := v.estado = 'sin_chofer' and not exists (select 1 from public.ofertas where viaje_id = v.id);

    if p_borrando or not f.activo or not public.fijo_corresponde(f, v.fecha_fija) then
      -- Ya no corresponde: si nadie lo vio, se borra; si ya se le ofreció a un chofer, se anula.
      if nunca_ofrecido then
        delete from public.viajes where id = v.id;
      else
        perform public.cerrar_oferta(v.id, 'cancelada');
        update public.viajes set estado = 'anulado', anulado_en = now(), anulado_por = auth.uid(), oferta_vence = null
        where id = v.id;
      end if;
    else
      pres := public.hora_argentina(v.fecha_fija, f.hora);
      update public.viajes
      set origen = f.origen, destino = f.destino, cliente_nombre = f.cliente_nombre,
          cliente_telefono = f.cliente_telefono, observaciones = f.observaciones, adjuntos = f.adjuntos,
          hora_presentacion = pres, hora_asignacion = pres - make_interval(mins => f.anticipacion)
      where id = v.id
        and (origen, destino, cliente_nombre, cliente_telefono, observaciones, adjuntos, hora_presentacion, hora_asignacion)
            is distinct from
            (f.origen, f.destino, f.cliente_nombre, f.cliente_telefono, f.observaciones, f.adjuntos, pres,
             pres - make_interval(mins => f.anticipacion));
      -- El chofer fijo nuevo solo se aplica a los que todavía no se le ofrecieron a nadie.
      if nunca_ofrecido and v.chofer_fijo is distinct from f.chofer_id then
        update public.viajes set chofer_fijo = f.chofer_id, espera_gestion = f.chofer_id is not null where id = v.id;
      end if;
    end if;
  end loop;

  perform set_config('app.sincronizando_fijo', '', true);
  if not p_borrando then perform public.crear_viajes_fijos(p_fijo); end if;
end;
$$;
revoke execute on function public.sincronizar_viaje_fijo(bigint, boolean) from public, anon, authenticated;

-- "Todos los que faltan" (026), ahora también con los adjuntos (vacío = no se tocan, para la pantalla vieja).
drop function public.cambiar_serie(bigint, time, integer, text, text, text, text, text);
create or replace function public.cambiar_serie(viaje bigint, p_hora time, p_anticipacion integer, p_origen text,
  p_destino text, p_cliente_nombre text, p_cliente_telefono text, p_observaciones text, p_adjuntos jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'Solo para gestión'; end if;
  select * into v from public.viajes where id = viaje;
  if v.viaje_fijo_id is null then raise exception 'Este viaje no es parte de una serie.'; end if;

  update public.viajes set editado_a_mano = false
  where viaje_fijo_id = v.viaje_fijo_id and editado_a_mano and iniciado_en is null
    and estado in ('sin_chofer', 'ofrecido', 'asignado') and hora_presentacion > now();

  -- Al guardar la serie, se actualizan sus viajes (disparador de 019).
  update public.viajes_fijos
  set hora = p_hora, anticipacion = p_anticipacion, origen = p_origen, destino = p_destino,
      cliente_nombre = p_cliente_nombre, cliente_telefono = p_cliente_telefono, observaciones = p_observaciones,
      adjuntos = coalesce(p_adjuntos, adjuntos)
  where id = v.viaje_fijo_id;
end;
$$;

---------------------------------------------------------------------------
-- Aviso al chofer: "🔄 Cambió tu viaje" también si se le agregó algo (igual que en 023, más los adjuntos).
---------------------------------------------------------------------------

-- "Se agregó una ubicación en Destino", uno por cada adjunto nuevo.
create or replace function public.texto_adjuntos_nuevos(p_antes jsonb, p_ahora jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg('Se agregó '
    || case n->>'tipo'
         when 'ubicacion' then 'una ubicación'
         when 'link' then coalesce('"' || nullif(n->>'nombre', '') || '"', 'un link')
         when 'foto' then 'una foto'
         when 'audio' then 'un audio'
         else 'un archivo'
       end
    || ' en ' || case n->>'campo' when 'origen' then 'Buscar en' when 'destino' then 'Destino' else 'Observaciones' end), '{}')
  from jsonb_array_elements(coalesce(p_ahora, '[]')) n
  where not exists (select 1 from jsonb_array_elements(coalesce(p_antes, '[]')) a where a->>'id' = n->>'id')
$$;

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
  if old.chofer_id is not null and old.estado in ('ofrecido', 'asignado') and auth.uid() is distinct from old.chofer_id
     and (new.estado = 'anulado' or new.chofer_id is distinct from old.chofer_id) then
    perform public.crear_aviso(new.id, old.chofer_id, '❌ Se anuló tu viaje',
      public.texto_cuando(old.tipo, old.hora_presentacion) || E'\n' || public.texto_recorrido(old.origen, old.destino),
      'viaje-' || new.id);
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
