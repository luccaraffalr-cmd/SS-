-- "🚗 Es hora de salir" con el origen primero (decidido el 22/10/2026: los choferes se confundían con el destino):
--   "Buscar en: Av. Rivadavia 2612" y abajo "Llevar a: Barrio Los Robles" (antes: "Av. Rivadavia 2612 → Barrio Los Robles").
-- Igual que en 023, cambiando solo el texto. Se ejecuta una sola vez en Supabase → SQL Editor.

create or replace function public.avisar_hora_de_salir()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.viajes;
begin
  for v in
    select * from public.viajes
    where estado = 'asignado' and iniciado_en is null and aviso_salida_en is null
      and hora_asignacion <= now() and hora_asignacion > now() - interval '2 hours'
    for update skip locked
  loop
    update public.viajes set aviso_salida_en = now() where id = v.id;
    perform public.crear_aviso(v.id, v.chofer_id, '🚗 Es hora de salir',
      public.texto_cuando(v.tipo, v.hora_presentacion) || E'\nBuscar en: ' || v.origen
        || coalesce(E'\nLlevar a: ' || v.destino, '')
        || E'\nAbrí la app y tocá "Salir a hacer el viaje".',
      'salida-' || v.id);
  end loop;
end;
$$;
revoke execute on function public.avisar_hora_de_salir() from public, anon, authenticated;
