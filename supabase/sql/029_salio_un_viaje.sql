-- "📣 Salió un viaje para Juan" (decidido el 20/10/2026, pedido del dueño): cuando la cola le ofrece un viaje a un chofer,
-- todos los choferes lo ven en su pantalla (y les llega un aviso, desde la función "notificar"), así si Juan no lo ve le
-- pueden avisar. Se muestra el cliente (no el origen ni el destino). Solo para los viajes que salen de la cola.
-- Se ejecuta una sola vez en Supabase → SQL Editor.

-- Viajes de la cola ofrecidos a un chofer y todavía sin aceptar.
create or replace function public.ofertas_en_curso()
returns table (viaje_id bigint, chofer_id uuid, chofer text, cliente text, desde timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.chofer_id, p.nombre, v.cliente_nombre, o.creada_en
  from public.viajes v
  join public.perfiles p on p.id = v.chofer_id
  join public.ofertas o on o.viaje_id = v.id and o.chofer_id = v.chofer_id and o.resultado = 'pendiente'
  where public.mi_rol() is not null
    and v.estado = 'ofrecido' and v.asignado_por is null  -- ofrecido por la cola (no asignado a mano por gestión)
  order by o.creada_en
$$;
revoke execute on function public.ofertas_en_curso() from public, anon;
