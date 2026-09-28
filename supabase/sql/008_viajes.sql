-- Tarea 9: viajes (cargar, editar y listar).
-- Incluye además el ajuste de "último reporte" (= última acción del chofer).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

---------------------------------------------------------------------------
-- Parte 1: "último reporte" = la última vez que el chofer hizo algo en la app.
---------------------------------------------------------------------------

drop function if exists public.reportar_chofer();

-- Darse de baja de la cola también cuenta como acción del chofer (cuando lo saca gestión, no).
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

---------------------------------------------------------------------------
-- Parte 2: viajes.
---------------------------------------------------------------------------

create table public.viajes (
  id                bigint generated always as identity primary key,  -- número de viaje
  creado_en         timestamptz not null default now(),
  creado_por        uuid references public.perfiles (id) default auth.uid(),

  tipo              text not null check (tipo in ('inmediato', 'programado')),
  cliente_nombre    text,
  cliente_telefono  text,
  origen            text not null,
  destino           text,
  observaciones     text,

  -- Programado: hora en que el auto tiene que estar en la dirección del cliente.
  hora_presentacion timestamptz,
  -- Desde cuándo se puede asignar. Inmediato: el momento en que se carga.
  hora_asignacion   timestamptz not null default now(),

  estado            text not null default 'sin_chofer'
    check (estado in ('sin_chofer', 'asignado', 'pago_pendiente', 'finalizado', 'fallido', 'anulado')),
  chofer_id         uuid references public.perfiles (id),

  check (tipo = 'inmediato' or hora_presentacion is not null)
);

create index viajes_hora_asignacion on public.viajes (hora_asignacion);
create index viajes_estado on public.viajes (estado);

alter table public.viajes enable row level security;

-- Gestión (admin y operadores) ve, carga y edita todos los viajes.
-- Los choferes todavía no ven viajes (se agrega en la tarea 13).
create policy "gestion ve viajes" on public.viajes
  for select to authenticated
  using (public.mi_rol() in ('admin', 'operador'));

create policy "gestion carga viajes" on public.viajes
  for insert to authenticated
  with check (public.mi_rol() in ('admin', 'operador'));

create policy "gestion edita viajes" on public.viajes
  for update to authenticated
  using (public.mi_rol() in ('admin', 'operador'))
  with check (public.mi_rol() in ('admin', 'operador'));

alter publication supabase_realtime add table public.viajes;
