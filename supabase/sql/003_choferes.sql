-- Tarea 5: perfil del chofer (auto, foto, oculto) y comisión.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

-- Datos del chofer y su auto. Los ven gestión y el propio chofer.
create table public.choferes (
  id          uuid primary key references public.perfiles (id) on delete cascade,
  auto_modelo text,
  auto_color  text,
  patente     text,
  foto_auto   text,            -- dirección de la foto en Storage
  oculto      boolean not null default false
);

-- La comisión va en una tabla aparte porque los operadores no ven plata.
create table public.comisiones (
  chofer_id  uuid primary key references public.perfiles (id) on delete cascade,
  porcentaje numeric(5,2) not null default 20 check (porcentaje between 0 and 100)
);

alter table public.choferes enable row level security;
alter table public.comisiones enable row level security;

create policy "ver choferes" on public.choferes
  for select to authenticated
  using (id = auth.uid() or public.mi_rol() in ('admin', 'operador'));

create policy "admin gestiona choferes" on public.choferes
  for all to authenticated
  using (public.mi_rol() = 'admin')
  with check (public.mi_rol() = 'admin');

-- Comisión: la ve el admin y el propio chofer. Solo el admin la cambia.
create policy "ver comision" on public.comisiones
  for select to authenticated
  using (chofer_id = auth.uid() or public.mi_rol() = 'admin');

create policy "admin gestiona comisiones" on public.comisiones
  for all to authenticated
  using (public.mi_rol() = 'admin')
  with check (public.mi_rol() = 'admin');

-- Cada vez que un usuario pasa a ser chofer, se le crean sus fichas (comisión 20% por defecto).
create or replace function public.crear_fichas_chofer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rol = 'chofer' then
    insert into public.choferes (id) values (new.id) on conflict (id) do nothing;
    insert into public.comisiones (chofer_id) values (new.id) on conflict (chofer_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger perfiles_crear_fichas_chofer
  after insert or update of rol on public.perfiles
  for each row execute function public.crear_fichas_chofer();

-- Choferes que ya existen.
insert into public.choferes (id) select id from public.perfiles where rol = 'chofer' on conflict do nothing;
insert into public.comisiones (chofer_id) select id from public.perfiles where rol = 'chofer' on conflict do nothing;

-- Carpeta pública para las fotos de los autos (en la etapa 2 las ve el cliente en el link de seguimiento).
insert into storage.buckets (id, name, public) values ('autos', 'autos', true)
on conflict (id) do nothing;

create policy "admin sube fotos de autos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'autos' and public.mi_rol() = 'admin');

create policy "admin cambia fotos de autos" on storage.objects
  for update to authenticated
  using (bucket_id = 'autos' and public.mi_rol() = 'admin');

create policy "admin borra fotos de autos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'autos' and public.mi_rol() = 'admin');
