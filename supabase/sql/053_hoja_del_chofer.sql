-- 053: la hoja de cada chofer en la planilla (3/11/2026).
-- En la planilla, cada chofer tiene su hoja: en la celda A2 dice su nombre, y sus cuentas suman las filas de la hoja de
-- respuestas que en la columna B (Chofer) dicen exactamente eso. La app anota los viajes con choferes.nombre_planilla
-- (o, si está vacío, con el nombre del usuario, que casi nunca coincide). Ahora la hoja se elige de una lista en la ficha
-- del chofer, y la primera vez que se elige se vuelven a anotar sus viajes ya pasados con ese nombre (así le suman).
-- Si después se cambia de una hoja a otra, los viajes ya anotados quedan en la anterior (solo los nuevos van a la otra).

create or replace function public.choferes_hoja_elegida()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(old.nombre_planilla), '') = '' and coalesce(trim(new.nombre_planilla), '') <> '' then
    update public.planilla_envios e
    set pendiente = true, pedido_en = now(), intentos = 0, error = null
    from public.viajes v
    where v.id = e.viaje_id and v.chofer_id = new.id and v.estado = 'finalizado';
    if found then perform public.avisar_a_la_planilla(); end if;
  end if;
  return null;
end;
$$;

create trigger choferes_hoja_elegida
  after update of nombre_planilla on public.choferes
  for each row execute function public.choferes_hoja_elegida();
