-- Link del pasajero con anticipación (pedido del dueño, 26/10/2026): en los viajes programados se puede generar y mandar
-- el link en cualquier momento, aunque todavía no tengan chofer (por ejemplo, a la noche para un viaje de la madrugada).
--   - Hasta que el chofer toca "Salir a hacer el viaje", el link muestra la fecha y la hora del viaje y, si ya hay un chofer
--     que lo aceptó, su nombre, el auto y la patente, pero sin el mapa (no se ve dónde está el chofer, por ejemplo a la noche
--     en su casa). El mapa con el auto en vivo aparece cuando sale a buscarlo.
--   - Un chofer al que solo se le ofreció (todavía no aceptó) no se muestra.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

-- Gestión genera el link: ahora también sin chofer (igual que en 017, sin pedir chofer).
create or replace function public.compartir_viaje(viaje bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'operador') then raise exception 'No permitido'; end if;

  select * into v from public.viajes where id = viaje for update;
  if not found or v.estado not in ('sin_chofer', 'ofrecido', 'asignado') then
    raise exception 'Solo se puede compartir un viaje que todavía no terminó.';
  end if;

  if v.codigo_seguimiento is null then
    update public.viajes set codigo_seguimiento = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
    where id = viaje
    returning * into v;
    perform public.registrar(viaje, 'Se generó el link de seguimiento');
  end if;
  return v.codigo_seguimiento;
end;
$$;
revoke execute on function public.compartir_viaje(bigint) from public, anon;

-- Lo que ve el pasajero (igual que en 024, más el estado "esperando": el chofer todavía no salió).
create or replace function public.ver_seguimiento(codigo text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.viajes;
  ch public.choferes;
  pr public.choferes_privado;
  u public.ubicaciones;
begin
  select * into v from public.viajes where codigo_seguimiento = codigo;
  if not found then return json_build_object('estado', 'inexistente'); end if;
  if v.estado not in ('ofrecido', 'asignado', 'sin_chofer') then return json_build_object('estado', 'terminado'); end if;

  -- Todavía no salió a buscarlo: la fecha y la hora, y el chofer si ya lo aceptó (sin dónde está).
  if v.iniciado_en is null then
    if v.estado = 'asignado' then
      select * into ch from public.choferes where id = v.chofer_id;
    end if;
    return json_build_object(
      'estado', 'esperando',
      'tipo', v.tipo,
      'presentacion', v.hora_presentacion,
      'chofer', case when v.estado = 'asignado' then public.nombre_de(v.chofer_id) end,
      'modelo', ch.auto_modelo,
      'color', ch.auto_color,
      'patente', ch.patente,
      'foto', ch.foto_auto
    );
  end if;

  select * into ch from public.choferes where id = v.chofer_id;
  select * into pr from public.choferes_privado where chofer_id = v.chofer_id;
  select * into u from public.ubicaciones where chofer_id = v.chofer_id;

  return json_build_object(
    'estado', 'activo',
    'chofer', public.nombre_de(v.chofer_id),
    'modelo', ch.auto_modelo,
    'color', ch.auto_color,
    'patente', ch.patente,
    'foto', ch.foto_auto,
    'dni', pr.dni,
    'alias', pr.alias,
    'lat', u.lat,
    'lon', u.lon,
    'velocidad', u.velocidad,
    'segundos', case when u.reportado_en is not null then extract(epoch from now() - u.reportado_en)::int end
  );
end;
$$;
