-- Viajes fijos: viajes que se repiten todas las semanas (ej. "todos los lunes a las 12").
-- El sistema crea solo los viajes programados de las próximas 4 semanas. Cada viaje creado es un
-- viaje normal: se puede cambiar o anular un día suelto sin tocar el viaje fijo.
-- Si se cambia el viaje fijo, se actualizan los viajes futuros que no se tocaron a mano.
-- Con chofer fijo: a cada viaje se lo ofrece a ese chofer 7 días antes de su hora de asignación
-- (lo tiene que aceptar, igual que una asignación a mano). Sin chofer: va por la cola.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

create table public.viajes_fijos (
  id               bigint generated always as identity primary key,
  creado_en        timestamptz not null default now(),
  creado_por       uuid references public.perfiles (id) default auth.uid(),
  activo           boolean not null default true,              -- false = pausado
  dias             smallint[] not null                          -- 0 = domingo … 6 = sábado
    check (cardinality(dias) between 1 and 7 and dias <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  hora             time not null,                               -- hora de presentación
  anticipacion     integer not null default 30 check (anticipacion between 0 and 1440),  -- minutos
  cliente_nombre   text,
  cliente_telefono text,
  origen           text not null,
  destino          text,
  observaciones    text,
  chofer_id        uuid references public.perfiles (id)         -- chofer fijo (opcional)
);

alter table public.viajes_fijos enable row level security;
create policy "gestion maneja viajes fijos" on public.viajes_fijos
  for all to authenticated
  using (public.mi_rol() in ('admin', 'operador'))
  with check (public.mi_rol() in ('admin', 'operador'));

alter publication supabase_realtime add table public.viajes_fijos;

-- De qué viaje fijo salió cada viaje, para qué día, y si alguien lo cambió a mano.
alter table public.viajes
  add column viaje_fijo_id  bigint references public.viajes_fijos (id) on delete set null,
  add column fecha_fija     date,
  add column chofer_fijo    uuid references public.perfiles (id),  -- se le ofrece 7 días antes
  add column editado_a_mano boolean not null default false,
  add constraint viajes_fijo_fecha unique (viaje_fijo_id, fecha_fija);

-- Zona horaria del negocio (las horas de los viajes fijos son hora argentina).
create or replace function public.hora_argentina(d date, h time)
returns timestamptz
language sql
stable
as $$ select (d + h) at time zone 'America/Argentina/Buenos_Aires' $$;

---------------------------------------------------------------------------
-- Marcas automáticas en los viajes.
---------------------------------------------------------------------------

create or replace function public.viajes_marcar_editado()
returns trigger
language plpgsql
as $$
begin
  -- Si gestión cambia o anula un día suelto, ese día ya no se actualiza con el viaje fijo.
  if new.viaje_fijo_id is not null and coalesce(current_setting('app.sincronizando_fijo', true), '') <> '1'
     and ((new.origen, new.destino, new.cliente_nombre, new.cliente_telefono, new.observaciones,
           new.tipo, new.hora_presentacion, new.hora_asignacion)
          is distinct from
          (old.origen, old.destino, old.cliente_nombre, old.cliente_telefono, old.observaciones,
           old.tipo, old.hora_presentacion, old.hora_asignacion)
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

create trigger viajes_marcar_editado
  before update on public.viajes
  for each row execute function public.viajes_marcar_editado();

---------------------------------------------------------------------------
-- Crear y actualizar los viajes de un viaje fijo.
---------------------------------------------------------------------------

-- Crea los viajes que falten de las próximas 4 semanas (los que ya existen, aunque estén anulados, no se tocan).
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

  for d in select hoy + i from generate_series(0, 27) as i loop
    continue when not (extract(dow from d)::smallint = any (f.dias));
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

-- Después de cambiar, pausar o borrar un viaje fijo: actualiza los viajes futuros que nadie tocó a mano.
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

    if p_borrando or not f.activo or not (extract(dow from v.fecha_fija)::smallint = any (f.dias)) then
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

-- Le ofrece al chofer fijo los viajes que están a 7 días o menos (los tiene que aceptar).
create or replace function public.ofrecer_viajes_fijos()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
  quien uuid;
begin
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));
  for v in
    select * from public.viajes
    where estado = 'sin_chofer' and espera_gestion and chofer_fijo is not null
      and hora_asignacion <= now() + interval '7 days'
    for update
  loop
    if exists (select 1 from public.perfiles where id = v.chofer_fijo and rol = 'chofer' and activo) then
      -- asignado_por marca que es un viaje con chofer fijo (se ve en naranja): quien cargó el viaje fijo.
      quien := coalesce((select creado_por from public.viajes_fijos where id = v.viaje_fijo_id),
                        (select id from public.perfiles where rol = 'admin' and activo order by creado_en limit 1));
      update public.viajes
      set estado = 'ofrecido', chofer_id = v.chofer_fijo, asignado_en = now(), asignado_por = quien,
          oferta_vence = null, aceptado_en = null, iniciado_en = null, espera_gestion = false
      where id = v.id;
      insert into public.ofertas (viaje_id, chofer_id, tipo) values (v.id, v.chofer_fijo, 'manual');
    else
      -- El chofer fijo ya no trabaja: el viaje va a la cola como cualquier programado.
      update public.viajes set chofer_fijo = null, espera_gestion = false where id = v.id;
    end if;
  end loop;
end;
$$;

-- Cada 10 minutos: crea los viajes que van entrando en las 4 semanas y ofrece los del chofer fijo.
create or replace function public.procesar_viajes_fijos()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
begin
  for f in select id from public.viajes_fijos where activo loop
    perform public.crear_viajes_fijos(f.id);
  end loop;
  perform public.ofrecer_viajes_fijos();
end;
$$;

revoke execute on function public.crear_viajes_fijos(bigint) from public, anon, authenticated;
revoke execute on function public.sincronizar_viaje_fijo(bigint, boolean) from public, anon, authenticated;
revoke execute on function public.ofrecer_viajes_fijos() from public, anon, authenticated;
revoke execute on function public.procesar_viajes_fijos() from public, anon, authenticated;

select cron.schedule('viajes-fijos', '*/10 * * * *', 'select public.procesar_viajes_fijos()');

-- Al cargar, cambiar, pausar o borrar un viaje fijo, se actualizan sus viajes en el momento.
create or replace function public.viajes_fijos_al_cambiar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sincronizar_viaje_fijo(old.id, true);
    return old;
  end if;
  perform public.sincronizar_viaje_fijo(new.id);
  perform public.ofrecer_viajes_fijos();
  return null;
end;
$$;

create trigger viajes_fijos_guardar
  after insert or update on public.viajes_fijos
  for each row execute function public.viajes_fijos_al_cambiar();

create trigger viajes_fijos_borrar
  before delete on public.viajes_fijos
  for each row execute function public.viajes_fijos_al_cambiar();

---------------------------------------------------------------------------
-- Los choferes no ven como "sin chofer" los viajes que esperan a su chofer fijo.
---------------------------------------------------------------------------

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
    and v.chofer_fijo is null
    and v.hora_asignacion <= now() + interval '24 hours'
  order by v.hora_asignacion, v.id
$$;
