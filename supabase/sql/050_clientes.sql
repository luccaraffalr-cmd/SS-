-- Clientes guardados (pedido del 2/11/2026; cambia lo decidido el 14/10, "se descartan los clientes guardados").
-- Paso 1 para que más adelante el link de seguimiento le llegue solo al cliente por WhatsApp: hace falta su teléfono.
--  - Tabla "clientes" (solo gestión): nombre, teléfono, nota fija y cuenta corriente. Se crean a mano, desde "Clientes";
--    en el viaje se eligen con un buscador (y sus viajes de siempre salen de sus viajes).
--  - Cada viaje (y viaje fijo) sabe de qué cliente es. El viaje copia la cuenta corriente del cliente
--    ("cuenta_sugerida_id"): el chofer no puede leer los clientes, y así al cargar el pago la ve ya elegida.
--  - Se cargan ya los clientes que están escritos en los viajes (agrupando los nombres sin tildes ni mayúsculas).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

create table public.clientes (
  id         bigint generated always as identity primary key,
  nombre     text not null check (trim(nombre) <> ''),
  telefono   text,      -- como se escribió (la app lo arma para WhatsApp)
  nota       text,      -- va sola a Observaciones al elegirlo en un viaje
  cuenta_id  bigint references public.cuentas_corrientes(id) on delete set null,
  creado_en  timestamptz not null default now(),
  creado_por uuid references public.perfiles(id) on delete set null default auth.uid()
);
alter table public.clientes enable row level security;
create policy "gestion maneja clientes" on public.clientes for all
  using (public.mi_rol() in ('admin', 'operador'))
  with check (public.mi_rol() in ('admin', 'operador'));

alter table public.viajes
  add column cliente_id bigint references public.clientes(id) on delete set null,
  add column cuenta_sugerida_id bigint references public.cuentas_corrientes(id) on delete set null;
alter table public.viajes_fijos
  add column cliente_id bigint references public.clientes(id) on delete set null;
create index viajes_cliente_id on public.viajes (cliente_id);

-- El viaje copia la cuenta corriente de su cliente (al cargarlo o al cambiarle el cliente).
create or replace function public.viajes_cuenta_del_cliente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.cuenta_sugerida_id := (select cuenta_id from public.clientes where id = new.cliente_id);
  return new;
end;
$$;
create trigger viajes_cuenta_del_cliente before insert or update of cliente_id on public.viajes
  for each row execute function public.viajes_cuenta_del_cliente();

-- Si gestión le cambia la cuenta al cliente, la toman sus viajes que todavía no se cobraron.
create or replace function public.clientes_cambio_de_cuenta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cuenta_id is distinct from old.cuenta_id then
    update public.viajes set cuenta_sugerida_id = new.cuenta_id
    where cliente_id = new.id and estado in ('sin_chofer', 'ofrecido', 'asignado', 'pago_pendiente');
  end if;
  return null;
end;
$$;
create trigger clientes_cambio_de_cuenta after update of cuenta_id on public.clientes
  for each row execute function public.clientes_cambio_de_cuenta();

-- Juntar dos clientes repetidos: los viajes (y viajes fijos) del que se va pasan al que queda, que completa los datos
-- que le falten. Solo gestión.
create or replace function public.juntar_clientes(p_queda bigint, p_se_va bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.clientes;
  s public.clientes;
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'Solo para gestión'; end if;
  if p_queda = p_se_va then raise exception 'Elegí otro cliente.'; end if;
  select * into q from public.clientes where id = p_queda for update;
  select * into s from public.clientes where id = p_se_va for update;
  if q.id is null or s.id is null then raise exception 'No se encontró uno de los clientes: recargá la pantalla.'; end if;

  update public.clientes
  set telefono = coalesce(nullif(trim(q.telefono), ''), s.telefono),
      nota = case when nullif(trim(q.nota), '') is null then s.nota
                  when nullif(trim(s.nota), '') is null or s.nota = q.nota then q.nota
                  else q.nota || E'\n' || s.nota end,
      cuenta_id = coalesce(q.cuenta_id, s.cuenta_id)
  where id = p_queda;
  update public.viajes set cliente_id = p_queda where cliente_id = p_se_va;
  update public.viajes_fijos set cliente_id = p_queda where cliente_id = p_se_va;
  delete from public.clientes where id = p_se_va;
end;
$$;
revoke execute on function public.juntar_clientes(bigint, bigint) from public, anon;
grant execute on function public.juntar_clientes(bigint, bigint) to authenticated;

-- Viajes fijos: cada viaje que se carga lleva el cliente de la serie (como antes, más cliente_id).
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
    insert into public.viajes (tipo, cliente_id, cliente_nombre, cliente_telefono, origen, destino, observaciones, adjuntos,
                               choferes_excluidos, hora_presentacion, hora_asignacion, creado_por,
                               viaje_fijo_id, fecha_fija, chofer_fijo, espera_gestion)
    values ('programado', f.cliente_id, f.cliente_nombre, f.cliente_telefono, f.origen, f.destino, f.observaciones,
            f.adjuntos, f.choferes_excluidos, pres, pres - make_interval(mins => f.anticipacion), null,
            f.id, d, f.chofer_id, f.chofer_id is not null)
    on conflict (viaje_fijo_id, fecha_fija) do nothing
    returning id into nuevo;

    if nuevo is not null then
      perform public.registrar(nuevo, 'Creado solo por el viaje fijo #' || f.id, null);
    end if;
  end loop;
end;
$$;

-- Al cambiar una serie, sus viajes pendientes toman también el cliente (como antes, más cliente_id).
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
      set origen = f.origen, destino = f.destino, cliente_id = f.cliente_id, cliente_nombre = f.cliente_nombre,
          cliente_telefono = f.cliente_telefono, observaciones = f.observaciones, adjuntos = f.adjuntos,
          choferes_excluidos = f.choferes_excluidos,
          hora_presentacion = pres, hora_asignacion = pres - make_interval(mins => f.anticipacion)
      where id = v.id
        and (origen, destino, cliente_id, cliente_nombre, cliente_telefono, observaciones, adjuntos, choferes_excluidos,
             hora_presentacion, hora_asignacion)
            is distinct from
            (f.origen, f.destino, f.cliente_id, f.cliente_nombre, f.cliente_telefono, f.observaciones, f.adjuntos,
             f.choferes_excluidos, pres, pres - make_interval(mins => f.anticipacion));
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

-- "Todos los que faltan" de una serie: también el cliente. p_cliente_id: null = no lo cambia (pantallas viejas),
-- 0 = sin cliente guardado.
drop function public.cambiar_serie(bigint, time, integer, text, text, text, text, text, jsonb, uuid[]);
create function public.cambiar_serie(viaje bigint, p_hora time, p_anticipacion integer, p_origen text, p_destino text,
                                     p_cliente_nombre text, p_cliente_telefono text, p_observaciones text,
                                     p_adjuntos jsonb default null, p_excluidos uuid[] default null,
                                     p_cliente_id bigint default null)
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
      adjuntos = coalesce(p_adjuntos, adjuntos), choferes_excluidos = coalesce(p_excluidos, choferes_excluidos),
      cliente_id = case when p_cliente_id is null then cliente_id when p_cliente_id = 0 then null else p_cliente_id end
  where id = v.viaje_fijo_id;
end;
$$;
revoke execute on function public.cambiar_serie(bigint, time, integer, text, text, text, text, text, jsonb, uuid[], bigint)
  from public, anon;
grant execute on function public.cambiar_serie(bigint, time, integer, text, text, text, text, text, jsonb, uuid[], bigint)
  to authenticated;

-- Importación: los clientes escritos en los viajes (y viajes fijos), agrupados sin tildes, mayúsculas ni espacios de
-- más. Queda la forma más usada del nombre, el último teléfono cargado y la última cuenta con la que pagó a cuenta.
create or replace function public.clave_cliente(t text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(translate(trim(coalesce(t, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g'), '')
$$;

with nombres as (
  select public.clave_cliente(cliente_nombre) as clave, regexp_replace(trim(cliente_nombre), '\s+', ' ', 'g') as nombre,
         nullif(trim(cliente_telefono), '') as telefono, creado_en as cuando,
         case when forma_pago = 'cuenta_corriente' then cuenta_id end as cuenta_id
  from public.viajes
  where estado <> 'anulado' and public.clave_cliente(cliente_nombre) is not null
  union all
  select public.clave_cliente(cliente_nombre), regexp_replace(trim(cliente_nombre), '\s+', ' ', 'g'),
         nullif(trim(cliente_telefono), ''), creado_en, null
  from public.viajes_fijos
  where public.clave_cliente(cliente_nombre) is not null
)
insert into public.clientes (nombre, telefono, cuenta_id, creado_por)
select mode() within group (order by nombre),
       (array_agg(telefono order by cuando desc) filter (where telefono is not null))[1],
       (array_agg(cuenta_id order by cuando desc) filter (where cuenta_id is not null))[1],
       null
from nombres
group by clave;

update public.viajes v set cliente_id = c.id
from public.clientes c
where v.cliente_id is null and public.clave_cliente(v.cliente_nombre) = public.clave_cliente(c.nombre);

update public.viajes_fijos f set cliente_id = c.id
from public.clientes c
where f.cliente_id is null and public.clave_cliente(f.cliente_nombre) = public.clave_cliente(c.nombre);
