-- DNI y alias (para transferencias) de cada chofer, que se muestran en el link del pasajero.
-- Van en una tabla aparte porque los choferes pueden ver la ficha de sus compañeros (para la cola),
-- y esto no lo tienen que ver: solo gestión, el propio chofer y el pasajero (por el link).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

create table public.choferes_privado (
  chofer_id uuid primary key references public.perfiles (id) on delete cascade,
  dni       text,
  alias     text
);

alter table public.choferes_privado enable row level security;

create policy "ver datos privados" on public.choferes_privado
  for select to authenticated
  using (chofer_id = auth.uid() or public.mi_rol() in ('admin', 'operador'));

create policy "admin gestiona datos privados" on public.choferes_privado
  for all to authenticated
  using (public.mi_rol() = 'admin')
  with check (public.mi_rol() = 'admin');

-- Link del pasajero: ahora también con DNI y alias.
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
  if v.chofer_id is null then return json_build_object('estado', 'sin_chofer'); end if;

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
