-- Link del pasajero con el viaje terminado (pedido del 6/11/2026): cuando el chofer termina el viaje se corta la ubicación,
-- pero siguen apareciendo el nombre del chofer, el auto y los datos para transferir (DNI y alias), para que el pasajero
-- pueda pagar después. Si el viaje se anuló (o no se pudo hacer), el link sigue sin mostrar nada del chofer.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

-- Lo que ve el pasajero (igual que en 044, más los datos del chofer en los terminados).
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

  -- Terminado: el chofer y cómo pagarle, sin dónde está.
  if v.estado in ('pago_pendiente', 'finalizado') and v.chofer_id is not null then
    select * into ch from public.choferes where id = v.chofer_id;
    select * into pr from public.choferes_privado where chofer_id = v.chofer_id;
    return json_build_object(
      'estado', 'terminado',
      'chofer', public.nombre_de(v.chofer_id),
      'modelo', ch.auto_modelo,
      'color', ch.auto_color,
      'patente', ch.patente,
      'foto', ch.foto_auto,
      'dni', pr.dni,
      'alias', pr.alias
    );
  end if;
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
