-- Choferes a los que no se les ofrece un viaje (pedido del dueño, 26/10/2026): por ejemplo, si a un cliente no le gusta
-- que lo lleven 2 de los 6 choferes.
--   - Se marcan en cada viaje ("No ofrecer a"); en los viajes fijos y series queda guardado y se copia a cada viaje.
--   - La cola se lo ofrece al primero de los que sí pueden. A los otros no se les ofrece, no lo pueden tomar, no lo ven en
--     el cartel de viajes sin chofer y no les suena el aviso.
--   - Si no hay ninguno de los que pueden: a los 2 minutos de quedar sin chofer se le da igual al primero de la cola (y lo
--     puede tomar cualquiera).
--   - Gestión se lo puede asignar a mano a uno de esos (la pantalla avisa "el cliente no lo quiere").
-- Se ejecuta una sola vez en Supabase → SQL Editor.

alter table public.viajes add column choferes_excluidos uuid[] not null default '{}';
alter table public.viajes_fijos add column choferes_excluidos uuid[] not null default '{}';

-- Los choferes que todavía no pueden recibir el viaje: los marcados, durante los 2 primeros minutos desde que necesita
-- chofer (su hora de asignación o cuando quedó sin chofer, lo que sea más tarde). Después, ninguno.
create or replace function public.excluidos_vigentes(v public.viajes)
returns uuid[]
language sql
stable
as $$
  select case when cardinality(v.choferes_excluidos) > 0
               and now() < greatest(v.hora_asignacion, coalesce(v.sin_chofer_desde, v.hora_asignacion)) + interval '2 minutes'
              then v.choferes_excluidos else '{}'::uuid[] end
$$;

---------------------------------------------------------------------------
-- La cola (igual que en 033, salteando a los excluidos).
---------------------------------------------------------------------------

create or replace function public.asignar_pendientes()
returns void
language plpgsql
security definer
set search_path = public
as $$
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
        oferta_vence = now() + interval '150 seconds'
    where id = w.id;

    insert into public.ofertas (viaje_id, chofer_id, tipo, vence)
    values (w.id, v_chofer, 'automatica', now() + interval '150 seconds');
  end loop;

  perform set_config('app.asignando', '', true);
end;
$$;
revoke execute on function public.asignar_pendientes() from public, anon, authenticated;

---------------------------------------------------------------------------
-- Tomar un viaje sin chofer (igual que en 034, sin los excluidos).
---------------------------------------------------------------------------

create or replace function public.tomar_viaje(viaje bigint)
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
  if c.oculto then raise exception 'Solo recibís viajes que te asigna gestión.'; end if;
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

  -- Libre o en la cola: sale a hacerlo ahora. En viaje: le queda como próximo viaje.
  if c.estado <> 'en_viaje' then
    perform public.iniciar_viaje_interno(viaje, auth.uid());
  end if;
end;
$$;
revoke execute on function public.tomar_viaje(bigint) from public, anon;

-- Cartel de viajes sin chofer (igual que en 035): los excluidos no lo ven mientras no lo pueden recibir.
create or replace function public.viajes_esperando()
returns table (id bigint, estado text, tipo text, hora_presentacion timestamptz, hora_asignacion timestamptz,
               origen text, destino text, tomar_desde timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.estado, v.tipo, v.hora_presentacion, v.hora_asignacion,
         case when public.tomar_desde(v) <= now() then v.origen end,
         case when public.tomar_desde(v) <= now() then v.destino end,
         public.tomar_desde(v)
  from public.viajes v
  where public.mi_rol() is not null
    and (v.estado = 'sin_chofer' or (v.estado = 'ofrecido' and v.asignado_por is null))
    and v.hora_asignacion <= now() + interval '24 hours'
    and not (auth.uid() = any (public.excluidos_vigentes(v)))
  order by v.hora_asignacion, v.id
$$;

-- Aviso "🆘 Viaje sin chofer" (igual que en 035): no les suena a los excluidos.
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
      where ch.estado <> 'fuera_de_servicio' and not ch.oculto and p.activo and p.rol = 'chofer'
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
-- Viajes fijos y series: los excluidos se copian a cada viaje (igual que en 031, más choferes_excluidos).
---------------------------------------------------------------------------

create or replace function public.viajes_marcar_editado()
returns trigger
language plpgsql
as $$
begin
  -- Si gestión cambia o anula un día suelto, ese día ya no se actualiza con el viaje fijo.
  if new.viaje_fijo_id is not null and coalesce(current_setting('app.sincronizando_fijo', true), '') <> '1'
     and ((new.origen, new.destino, new.cliente_nombre, new.cliente_telefono, new.observaciones,
           new.tipo, new.hora_presentacion, new.hora_asignacion, new.adjuntos, new.choferes_excluidos)
          is distinct from
          (old.origen, old.destino, old.cliente_nombre, old.cliente_telefono, old.observaciones,
           old.tipo, old.hora_presentacion, old.hora_asignacion, old.adjuntos, old.choferes_excluidos)
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
                               choferes_excluidos, hora_presentacion, hora_asignacion, creado_por,
                               viaje_fijo_id, fecha_fija, chofer_fijo, espera_gestion)
    values ('programado', f.cliente_nombre, f.cliente_telefono, f.origen, f.destino, f.observaciones, f.adjuntos,
            f.choferes_excluidos, pres, pres - make_interval(mins => f.anticipacion), null,
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
          choferes_excluidos = f.choferes_excluidos,
          hora_presentacion = pres, hora_asignacion = pres - make_interval(mins => f.anticipacion)
      where id = v.id
        and (origen, destino, cliente_nombre, cliente_telefono, observaciones, adjuntos, choferes_excluidos,
             hora_presentacion, hora_asignacion)
            is distinct from
            (f.origen, f.destino, f.cliente_nombre, f.cliente_telefono, f.observaciones, f.adjuntos, f.choferes_excluidos,
             pres, pres - make_interval(mins => f.anticipacion));
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

-- "Todos los que faltan" (031), ahora también con los choferes excluidos (vacío = no se tocan).
drop function public.cambiar_serie(bigint, time, integer, text, text, text, text, text, jsonb);
create or replace function public.cambiar_serie(viaje bigint, p_hora time, p_anticipacion integer, p_origen text,
  p_destino text, p_cliente_nombre text, p_cliente_telefono text, p_observaciones text, p_adjuntos jsonb default null,
  p_excluidos uuid[] default null)
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
      adjuntos = coalesce(p_adjuntos, adjuntos), choferes_excluidos = coalesce(p_excluidos, choferes_excluidos)
  where id = v.viaje_fijo_id;
end;
$$;
