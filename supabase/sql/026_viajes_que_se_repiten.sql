-- Viajes que se repiten, como en el calendario de Samsung (decidido el 15/10/2026). Se cargan desde "Nuevo viaje" → Repetir:
--   1) Días sueltos: el mismo viaje para varios días elegidos (ej. jue 15, lun 19 y vie 23), agrupados en una serie.
--   2) Todas las semanas por un tiempo: los viajes fijos ahora tienen "desde" y "hasta" (hasta vacío = no termina).
--   3) Al cambiar o anular un viaje de una serie, gestión elige si es solo ese o todos los que faltan.
-- Las series usan la misma tabla y el mismo funcionamiento que los viajes fijos (019).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

---------------------------------------------------------------------------
-- 1) y 2) Fechas de la serie.
---------------------------------------------------------------------------

alter table public.viajes_fijos
  add column desde  date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  add column hasta  date,    -- último día (vacío = no termina)
  add column fechas date[];  -- días sueltos: si tiene fechas, se usan esas y no los días de la semana

-- Los días de la semana ya no son obligatorios si la serie es de días sueltos.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.viajes_fijos'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%dias%'
  loop
    execute format('alter table public.viajes_fijos drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.viajes_fijos
  add constraint viajes_fijos_dias_check check (
    dias <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
    and (coalesce(cardinality(fechas), 0) >= 1 or cardinality(dias) between 1 and 7)),
  add constraint viajes_fijos_hasta_check check (hasta is null or hasta >= desde);

-- ¿La serie tiene viaje ese día?
create or replace function public.fijo_corresponde(f public.viajes_fijos, d date)
returns boolean
language sql
immutable
as $$
  select case when f.fechas is not null then d = any (f.fechas)
              else extract(dow from d)::smallint = any (f.dias) and d >= f.desde and (f.hasta is null or d <= f.hasta)
         end
$$;

-- Crea los viajes que falten: los días sueltos, todos; los de todas las semanas, los de las próximas 4 semanas.
-- (Los que ya existen, aunque estén anulados, no se tocan.)
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
    pres := public.hora_argentina(d, f.hora);
    continue when pres <= now();

    nuevo := null;
    insert into public.viajes (tipo, cliente_nombre, cliente_telefono, origen, destino, observaciones,
                               hora_presentacion, hora_asignacion, creado_por,
                               viaje_fijo_id, fecha_fija, chofer_fijo, espera_gestion)
    values ('programado', f.cliente_nombre, f.cliente_telefono, f.origen, f.destino, f.observaciones,
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

-- Después de cambiar, pausar o borrar una serie: actualiza los viajes futuros que nadie tocó a mano.
-- (Igual que en 019; ahora un día "ya no corresponde" también si quedó fuera de desde/hasta o de los días sueltos.)
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
          cliente_telefono = f.cliente_telefono, observaciones = f.observaciones,
          hora_presentacion = pres, hora_asignacion = pres - make_interval(mins => f.anticipacion)
      where id = v.id
        and (origen, destino, cliente_nombre, cliente_telefono, observaciones, hora_presentacion, hora_asignacion)
            is distinct from
            (f.origen, f.destino, f.cliente_nombre, f.cliente_telefono, f.observaciones, pres,
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

---------------------------------------------------------------------------
-- 3) Cambiar o anular todos los que faltan de una serie (desde un viaje de la serie).
---------------------------------------------------------------------------

-- "Todos los que faltan": los datos nuevos van a la serie y a todos sus viajes que todavía no salieron,
-- aunque se hubieran cambiado a mano (los anulados quedan anulados). La fecha de cada viaje no cambia.
create or replace function public.cambiar_serie(viaje bigint, p_hora time, p_anticipacion integer, p_origen text,
  p_destino text, p_cliente_nombre text, p_cliente_telefono text, p_observaciones text)
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
      cliente_nombre = p_cliente_nombre, cliente_telefono = p_cliente_telefono, observaciones = p_observaciones
  where id = v.viaje_fijo_id;
end;
$$;

-- "Este y los que siguen": se anula este viaje y la serie termina el día anterior (no se cargan más).
create or replace function public.anular_serie(viaje bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
  f public.viajes_fijos;
  w public.viajes;
  quedan date[];
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'Solo para gestión'; end if;
  select * into v from public.viajes where id = viaje;
  select * into f from public.viajes_fijos where id = v.viaje_fijo_id;
  if not found then raise exception 'Este viaje no es parte de una serie.'; end if;

  -- Este viaje, como cualquier anulación (si lo estaba haciendo, el chofer vuelve al puesto 1).
  perform public.anular_viaje(viaje);

  -- La serie termina antes de este día. Si no le queda ningún día, se pausa.
  if f.fechas is not null then
    quedan := array(select x from unnest(f.fechas) as x where x < v.fecha_fija order by x);
    if cardinality(quedan) = 0 then
      update public.viajes_fijos set activo = false where id = f.id;
    else
      update public.viajes_fijos set fechas = quedan where id = f.id;
    end if;
  elsif v.fecha_fija - 1 < f.desde then
    update public.viajes_fijos set activo = false where id = f.id;
  else
    update public.viajes_fijos set hasta = v.fecha_fija - 1 where id = f.id;
  end if;

  -- Los que siguen y se habían cambiado a mano también se anulan (los demás los saca la serie al guardarse).
  for w in
    select * from public.viajes
    where viaje_fijo_id = f.id and fecha_fija > v.fecha_fija and iniciado_en is null
      and estado in ('sin_chofer', 'ofrecido', 'asignado')
  loop
    perform public.anular_viaje(w.id);
  end loop;
end;
$$;
