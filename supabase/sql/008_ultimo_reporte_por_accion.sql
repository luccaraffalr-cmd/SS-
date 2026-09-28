-- "Último reporte" = la última vez que el chofer hizo algo en la app (cambió su estado).
-- Ya no se anota solo por tener la app abierta.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

drop function if exists public.reportar_chofer();

-- Darse de baja de la cola también cuenta como acción del chofer
-- (cuando lo saca gestión, no).
create or replace function public.salir_de_cola(chofer uuid default null)
returns public.choferes
language plpgsql
security definer
set search_path = public
as $$
declare
  fila public.choferes;
  quien uuid := coalesce(chofer, auth.uid());
  es_el_chofer boolean := public.mi_rol() = 'chofer' and quien = auth.uid();
begin
  if not (coalesce(public.mi_rol(), '') in ('admin', 'operador') or es_el_chofer) then
    raise exception 'No permitido';
  end if;

  update public.choferes
  set estado = 'libre', estado_desde = now(), anunciado_en = null,
      ultimo_reporte = case when es_el_chofer then now() else ultimo_reporte end
  where id = quien and estado = 'en_cola'
  returning * into fila;

  if not found then select * into fila from public.choferes where id = quien; end if;
  return fila;
end;
$$;
