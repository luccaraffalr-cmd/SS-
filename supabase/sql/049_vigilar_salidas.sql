-- Viaje asignado que el chofer no sale a hacer (pedido del 2/11/2026; pasaría sobre todo de noche: un viaje de las 3:00
-- asignado a un chofer, del que solo saben gestión y él). A toda hora, desde la hora de salir (hora de asignación):
--  - 0 min: "🚗 Es hora de salir" (como antes), con la hora límite.
--  - Cada 2 min: "⏰ Todavía no saliste" (o "Todavía no aceptaste el viaje", si gestión se lo asignó y no lo aceptó), con
--    el sonido fuerte. No se puede poner sin sonido en "Mis avisos".
--  - A los 5 min, si no tocó "Salir a hacer el viaje": la app se lo saca y lo manda a la cola como prioritario (como
--    "↩️ Mandar a la cola", SQL 048: no se le vuelve a ofrecer). Le llega "⌛ Se te pasó el viaje" y, si estaba en la
--    cola, queda Libre (para que no frene la cola sin contestar). Nadie más se entera de que era de él.
-- Si está haciendo otro viaje, la cuenta espera: arranca (de cero) cuando lo termina.
-- Corre cada minuto con el cron que ya existe "aviso-hora-de-salir" (avisar_hora_de_salir ahora llama a vigilar_salidas).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

alter table public.viajes
  add column salida_vigilada_desde timestamptz,   -- desde cuándo corren los 5 minutos para salir
  add column recordatorio_salida_en timestamptz;  -- último aviso al chofer

-- Si cambia el chofer o la hora, todo de nuevo (el nuevo chofer también tiene sus 5 minutos).
create or replace function public.viajes_reiniciar_aviso()
returns trigger
language plpgsql
as $$
begin
  if new.hora_asignacion is distinct from old.hora_asignacion or new.chofer_id is distinct from old.chofer_id then
    new.aviso_salida_en := null;
    new.salida_vigilada_desde := null;
    new.recordatorio_salida_en := null;
  end if;
  return new;
end;
$$;

create or replace function public.vigilar_salidas()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
  limite timestamptz;
  hasta text;
  recorrido text;
  nombre text;
  estaba_en_cola boolean;
  saco_alguno boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('asignar_pendientes'));

  for v in
    select x.* from public.viajes x
    where x.chofer_id is not null and x.iniciado_en is null
      and (x.estado = 'asignado' or (x.estado = 'ofrecido' and x.asignado_por is not null))
      and x.hora_asignacion <= now() and x.hora_asignacion > now() - interval '2 hours'
    for update of x skip locked
  loop
    -- Sin aceptar, en los inmediatos, nada de la dirección (como en la oferta).
    recorrido := case when v.estado = 'ofrecido' and v.tipo = 'inmediato' then ''
                      else E'\n' || public.texto_recorrido(v.origen, v.destino) end;

    -- Haciendo otro viaje: está trabajando. Le suena "Es hora de salir" y la cuenta espera a que lo termine.
    if exists (select 1 from public.viajes o
               where o.chofer_id = v.chofer_id and o.estado = 'asignado' and o.iniciado_en is not null and o.id <> v.id) then
      if v.estado = 'asignado' and v.aviso_salida_en is null then
        update public.viajes set aviso_salida_en = now() where id = v.id;
        perform public.crear_aviso(v.id, v.chofer_id, '🚗 Es hora de salir',
          public.texto_cuando(v.tipo, v.hora_presentacion) || recorrido
            || E'\nAbrí la app y tocá "Salir a hacer el viaje".',
          'salida-' || v.id);
      end if;
      if v.salida_vigilada_desde is not null then
        update public.viajes set salida_vigilada_desde = null, recordatorio_salida_en = null where id = v.id;
      end if;
      continue;
    end if;

    -- Arranca la cuenta de 5 minutos.
    if v.salida_vigilada_desde is null then
      hasta := to_char((now() + interval '5 minutes') at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI');
      update public.viajes set salida_vigilada_desde = now(), recordatorio_salida_en = now() where id = v.id;
      if v.estado = 'ofrecido' then
        perform public.crear_aviso(v.id, v.chofer_id, '⏰ Todavía no aceptaste el viaje',
          public.texto_cuando(v.tipo, v.hora_presentacion) || recorrido
            || E'\nYa es hora de salir. Aceptalo y tocá "Salir a hacer el viaje" antes de las ' || hasta
            || ': si no, pasa a otro chofer.',
          'salida-' || v.id);
      elsif v.aviso_salida_en is null then
        update public.viajes set aviso_salida_en = now() where id = v.id;
        perform public.crear_aviso(v.id, v.chofer_id, '🚗 Es hora de salir',
          public.texto_cuando(v.tipo, v.hora_presentacion) || recorrido
            || E'\nAbrí la app y tocá "Salir a hacer el viaje" antes de las ' || hasta || ': si no, pasa a otro chofer.',
          'salida-' || v.id);
      end if;
      continue;
    end if;

    -- (10 segundos de margen: el cron corre cada minuto, no siempre en el mismo segundo.)
    limite := v.salida_vigilada_desde + interval '5 minutes';
    hasta := to_char(limite at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI');

    if now() >= limite - interval '10 seconds' then
      -- Se pasaron los 5 minutos: se lo saca y va a la cola, prioritario. No se le vuelve a ofrecer (SQL 048).
      nombre := public.nombre_de(v.chofer_id);
      insert into public.viajes_sacados (viaje_id, chofer_id) values (v.id, v.chofer_id) on conflict do nothing;
      perform public.cerrar_oferta(v.id, 'cancelada');
      perform set_config('app.asignando', '1', true);  -- el aviso al chofer es el de abajo, no "Se anuló tu viaje"
      update public.viajes
      set estado = 'sin_chofer', chofer_id = null, asignado_en = null, asignado_por = null, oferta_vence = null,
          aceptado_en = null, espera_gestion = false, prioritario = true
      where id = v.id;
      perform set_config('app.asignando', '', true);

      -- Si estaba en la cola sin contestar, sale (queda Libre) para no frenar los otros viajes.
      update public.choferes set estado = 'libre', anunciado_en = null, estado_desde = now()
      where id = v.chofer_id and estado = 'en_cola'
      returning true into estaba_en_cola;

      perform public.registrar(v.id, 'La app se lo sacó a ' || nombre
        || case when v.estado = 'ofrecido' then ': no lo aceptó' else ': no salió a hacerlo' end
        || ' a tiempo (5 minutos). Va a la cola como prioritario', null);
      perform public.crear_aviso(v.id, v.chofer_id, '⌛ Se te pasó el viaje',
        public.texto_cuando(v.tipo, v.hora_presentacion) || recorrido
          || E'\nNo saliste a hacerlo a tiempo: pasó a otro chofer.'
          || case when coalesce(estaba_en_cola, false)
                  then E'\nSaliste de la cola: anunciate de nuevo cuando estés.' else '' end,
        'viaje-' || v.id);
      saco_alguno := true;

    elsif now() >= v.recordatorio_salida_en + interval '2 minutes' - interval '10 seconds' then
      update public.viajes set recordatorio_salida_en = now() where id = v.id;
      perform public.crear_aviso(v.id, v.chofer_id,
        case when v.estado = 'ofrecido' then '⏰ Todavía no aceptaste el viaje' else '⏰ Todavía no saliste' end,
        public.texto_cuando(v.tipo, v.hora_presentacion) || recorrido
          || case when v.estado = 'ofrecido' then E'\nAceptalo y tocá "Salir a hacer el viaje" antes de las '
                  else E'\nTocá "Salir a hacer el viaje" antes de las ' end
          || hasta || ': si no, pasa a otro chofer.',
        'salida-' || v.id);
    end if;
  end loop;

  if saco_alguno then
    perform public.asignar_pendientes();
  end if;
end;
$$;
revoke execute on function public.vigilar_salidas() from public, anon, authenticated;

-- El cron "aviso-hora-de-salir" (cada minuto) ahora hace todo esto.
create or replace function public.avisar_hora_de_salir()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.vigilar_salidas();
end;
$$;
