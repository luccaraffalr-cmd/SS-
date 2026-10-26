-- Viajes inmediatos (pedido del dueño, 26/10/2026): mientras el chofer no lo aceptó, no ve nada de la dirección (ni
-- origen, ni destino, ni observaciones). La pantalla y el aviso "Viaje para vos" ya no la muestran; acá, los avisos de
-- cambios ("Cambió tu viaje") y "Se anuló tu viaje" de un inmediato que todavía no aceptó.
-- Igual que en 035, más eso. Se ejecuta una sola vez en Supabase → SQL Editor.

create or replace function public.viajes_avisar_cambios()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cambios text[] := '{}';
  ofrecido boolean := new.estado = 'ofrecido';
  sin_direccion boolean := new.estado = 'ofrecido' and new.tipo = 'inmediato';  -- inmediato sin aceptar: nada de la dirección
begin
  -- Lo que hace el propio chofer (rechazar, finalizar…) no se le avisa.
  -- 3) Ya no es su viaje: tenía el viaje (ofrecido, aceptado o haciéndolo) y gestión lo anuló, se lo pasó a otro
  --    o lo dejó sin chofer. Para el chofer es el mismo aviso: "Se anuló tu viaje".
  --    (Si la oferta de la cola venció, el aviso es otro: lo manda asignar_pendientes.)
  if old.chofer_id is not null and old.estado in ('ofrecido', 'asignado') and auth.uid() is distinct from old.chofer_id
     and (new.estado = 'anulado' or new.chofer_id is distinct from old.chofer_id) then
    if coalesce(current_setting('app.asignando', true), '') <> '1' then
      perform public.crear_aviso(new.id, old.chofer_id, '❌ Se anuló tu viaje',
        public.texto_cuando(old.tipo, old.hora_presentacion)
          || case when old.estado = 'ofrecido' and old.tipo = 'inmediato' then ''
                  when old.estado = 'ofrecido' then E'\nBuscar en: ' || old.origen
                  else E'\n' || public.texto_recorrido(old.origen, old.destino) end,
        'viaje-' || new.id);
    end if;
    return null;
  end if;

  -- 2) Cambió el horario, el origen o el destino de un viaje suyo (desde que se lo asignan hasta que lo finaliza),
  --    o se le agregó un adjunto. Mientras no lo aceptó, nada del destino (y en los inmediatos, nada de la dirección).
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
    if new.origen is distinct from old.origen and not sin_direccion then
      cambios := cambios || ('Buscar en: ' || new.origen);
    end if;
    if new.destino is distinct from old.destino and not ofrecido then
      cambios := cambios || ('Destino: ' || coalesce(new.destino, 'sin destino'));
    end if;
    if new.adjuntos is distinct from old.adjuntos and not sin_direccion then
      cambios := cambios || case when ofrecido
        then public.texto_adjuntos_nuevos(public.sin_adjuntos_de_destino(old.adjuntos), public.sin_adjuntos_de_destino(new.adjuntos))
        else public.texto_adjuntos_nuevos(old.adjuntos, new.adjuntos) end;
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
