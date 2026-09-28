-- Tarea 16: registro de quién hizo qué con cada viaje, y cuándo.
-- Se anota solo (disparadores), sin tocar las funciones que ya existen.
-- hecho_por vacío = lo hizo el sistema (asignación automática, oferta vencida…).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

create table public.registro (
  id        bigint generated always as identity primary key,
  viaje_id  bigint references public.viajes (id) on delete cascade,
  accion    text not null,
  hecho_por uuid references public.perfiles (id),
  hecho_en  timestamptz not null default now()
);
create index registro_viaje on public.registro (viaje_id, hecho_en);

alter table public.registro enable row level security;
create policy "gestion ve el registro" on public.registro
  for select to authenticated using (public.mi_rol() in ('admin', 'operador'));

create or replace function public.nombre_de(persona uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select nombre from public.perfiles where id = persona), '?')
$$;

create or replace function public.registrar(p_viaje bigint, p_accion text, p_por uuid default auth.uid())
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.registro (viaje_id, accion, hecho_por) values (p_viaje, p_accion, p_por);
$$;
revoke execute on function public.registrar(bigint, text, uuid) from public, anon, authenticated;

-- Ofertas: a quién se le ofreció o asignó, y qué respondió.
create or replace function public.registro_ofertas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chofer text := public.nombre_de(new.chofer_id);
begin
  if tg_op = 'INSERT' then
    if new.tipo = 'automatica' then
      perform public.registrar(new.viaje_id, 'Se le ofreció a ' || chofer || ' (automático)', null);
    else
      perform public.registrar(new.viaje_id, 'Asignado a mano a ' || chofer);
    end if;
  elsif old.resultado = 'pendiente' and new.resultado <> 'pendiente' then
    perform public.registrar(new.viaje_id,
      case new.resultado
        when 'aceptada'  then chofer || ' aceptó'
        when 'rechazada' then chofer || ' rechazó'
        when 'vencida'   then chofer || ' no contestó a tiempo'
        else 'Se le sacó el viaje a ' || chofer
      end,
      case when new.resultado = 'vencida' then null else auth.uid() end);
  end if;
  return null;
end;
$$;

create trigger ofertas_registro
  after insert or update of resultado on public.ofertas
  for each row execute function public.registro_ofertas();

-- Viajes: carga, ediciones, salida, fin, pago, anulación y prioridad.
create or replace function public.registro_viajes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  campos text[] := '{}';
  forma  text;
begin
  if tg_op = 'INSERT' then
    perform public.registrar(new.id, 'Viaje cargado');
    return null;
  end if;

  if old.iniciado_en is null and new.iniciado_en is not null then
    perform public.registrar(new.id, public.nombre_de(new.chofer_id) || ' salió a hacer el viaje');
  end if;

  forma := case new.forma_pago
    when 'efectivo' then 'efectivo'
    when 'transferencia_chofer' then 'transferencia al chofer'
    when 'transferencia_duenio' then 'transferencia al dueño'
    when 'cuenta_corriente' then 'cuenta corriente'
  end;

  if new.estado is distinct from old.estado then
    if new.estado = 'anulado' then
      perform public.registrar(new.id, 'Viaje anulado');
    elsif new.estado = 'pago_pendiente' then
      perform public.registrar(new.id, 'Finalizado, con el pago pendiente');
    elsif new.estado = 'fallido' then
      perform public.registrar(new.id, 'Fallido' || coalesce(': ' || new.motivo_fallido, ''));
    elsif new.estado = 'finalizado' then
      perform public.registrar(new.id, 'Pago cargado: $ ' || new.importe || ' · ' || forma);
    end if;
  elsif new.estado = 'finalizado' and (new.importe, new.forma_pago, new.cuenta_id, new.cuenta_otro)
        is distinct from (old.importe, old.forma_pago, old.cuenta_id, old.cuenta_otro) then
    perform public.registrar(new.id, 'Pago corregido: antes $ ' || coalesce(old.importe::text, '?')
      || ', ahora $ ' || new.importe || ' · ' || forma);
  end if;

  if new.prioritario is distinct from old.prioritario then
    perform public.registrar(new.id, case when new.prioritario then 'Priorizado ⭐' else 'Se le quitó la prioridad' end);
  end if;

  if new.origen is distinct from old.origen then campos := campos || 'origen'::text; end if;
  if new.destino is distinct from old.destino then campos := campos || 'destino'::text; end if;
  if new.cliente_nombre is distinct from old.cliente_nombre then campos := campos || 'cliente'::text; end if;
  if new.cliente_telefono is distinct from old.cliente_telefono then campos := campos || 'teléfono'::text; end if;
  if new.observaciones is distinct from old.observaciones then campos := campos || 'observaciones'::text; end if;
  if new.tipo is distinct from old.tipo or new.hora_presentacion is distinct from old.hora_presentacion
     or (new.hora_asignacion is distinct from old.hora_asignacion and new.tipo = 'programado') then
    campos := campos || 'horario'::text;
  end if;
  if array_length(campos, 1) > 0 then
    perform public.registrar(new.id, 'Datos editados: ' || array_to_string(campos, ', '));
  end if;

  return null;
end;
$$;

create trigger viajes_registro
  after insert or update on public.viajes
  for each row execute function public.registro_viajes();
