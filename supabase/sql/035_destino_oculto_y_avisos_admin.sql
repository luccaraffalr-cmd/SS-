-- Pedidos del dueño (24/10/2026):
--   1) El chofer no ve el destino de un viaje hasta que lo acepta (ofertas de la cola y asignaciones a mano), para que no
--      elija los viajes por a dónde van. Cuando el viaje se libera para que lo tome cualquiera, ahí sí se ve todo.
--      (La pantalla y el aviso "Viaje para vos" ya no lo muestran; acá: los avisos de cambios y el cartel de viajes
--      sin chofer, que muestra origen y destino recién cuando se libera.)
--   2) Al admin le suena solo cuando no hay nadie para tomar un viaje: cuando se libera para todos los choferes
--      (nadie de la cola lo tomó). Ya no le suenan "Salió un viaje para Juan", "no aceptó" ni "no salió" (siguen en el
--      cartel rojo). Los que esperan a gestión (un chofer rechazó una asignación a mano) no se liberan nunca: de esos
--      le sigue sonando "Viaje sin chofer" a su hora, porque solo gestión los puede resolver.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

---------------------------------------------------------------------------
-- 1) Destino oculto hasta aceptar.
---------------------------------------------------------------------------

-- Los adjuntos sin los del destino.
create or replace function public.sin_adjuntos_de_destino(p jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(coalesce(p, '[]')) x where x->>'campo' <> 'destino'
$$;

-- Igual que en 033, sin mostrar el destino mientras el viaje está ofrecido (todavía no lo aceptó).
create or replace function public.viajes_avisar_cambios()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cambios text[] := '{}';
  ofrecido boolean := new.estado = 'ofrecido';
begin
  -- Lo que hace el propio chofer (rechazar, finalizar…) no se le avisa.
  -- 3) Ya no es su viaje: tenía el viaje (ofrecido, aceptado o haciéndolo) y gestión lo anuló, se lo pasó a otro
  --    o lo dejó sin chofer. Para el chofer es el mismo aviso: "Se anuló tu viaje".
  --    (Si la oferta de la cola venció, el aviso es otro: lo manda asignar_pendientes.)
  if old.chofer_id is not null and old.estado in ('ofrecido', 'asignado') and auth.uid() is distinct from old.chofer_id
     and (new.estado = 'anulado' or new.chofer_id is distinct from old.chofer_id) then
    if coalesce(current_setting('app.asignando', true), '') <> '1' then
      perform public.crear_aviso(new.id, old.chofer_id, '❌ Se anuló tu viaje',
        public.texto_cuando(old.tipo, old.hora_presentacion) || E'\n'
          || case when old.estado = 'ofrecido' then 'Buscar en: ' || old.origen
                  else public.texto_recorrido(old.origen, old.destino) end,
        'viaje-' || new.id);
    end if;
    return null;
  end if;

  -- 2) Cambió el horario, el origen o el destino de un viaje suyo (desde que se lo asignan hasta que lo finaliza),
  --    o se le agregó un adjunto. Mientras no lo aceptó, nada del destino.
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
    if new.destino is distinct from old.destino and not ofrecido then
      cambios := cambios || ('Destino: ' || coalesce(new.destino, 'sin destino'));
    end if;
    if new.adjuntos is distinct from old.adjuntos then
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

-- Cartel de viajes sin chofer (igual que en 034): origen y destino recién cuando se libera para que lo tome cualquiera.
drop function public.viajes_esperando();
create function public.viajes_esperando()
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
  order by v.hora_asignacion, v.id
$$;

---------------------------------------------------------------------------
-- 2) Avisos al admin: solo cuando no hay nadie para tomar un viaje.
---------------------------------------------------------------------------

-- Igual que en 030, pero solo los viajes sin chofer que esperan a gestión (no se liberan nunca para los choferes).
create or replace function public.avisar_alertas_gestion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
  a record;
begin
  for v in
    select * from public.viajes
    where alerta_gestion_en is null and iniciado_en is null and estado = 'sin_chofer' and espera_gestion
      and hora_asignacion <= now() and hora_asignacion > now() - interval '2 hours'
    for update skip locked
  loop
    update public.viajes set alerta_gestion_en = now() where id = v.id;
    for a in select id from public.perfiles where rol = 'admin' and activo loop
      perform public.crear_aviso(v.id, a.id, '⚠️ Viaje sin chofer',
        public.texto_cuando(v.tipo, v.hora_presentacion)
          || coalesce(E'\nCliente: ' || v.cliente_nombre, '')
          || E'\n' || public.texto_recorrido(v.origen, v.destino)
          || case when v.rechazado_por is not null then E'\nLo rechazó ' || public.nombre_de(v.rechazado_por) else '' end
          || E'\nLo tenés que asignar desde gestión.',
        'alerta-' || v.id);
    end loop;
  end loop;
end;
$$;
revoke execute on function public.avisar_alertas_gestion() from public, anon, authenticated;

-- Igual que en 034, y además a los admins: "⚠️ Nadie tomó el viaje" en el momento en que se libera para todos.
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
