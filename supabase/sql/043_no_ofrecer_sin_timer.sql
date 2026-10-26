-- "No ofrecer a" sin los 2 minutos (pedido del dueño, 26/10/2026): a los choferes marcados no se les ofrece el viaje en
-- ningún momento (por ejemplo, viajes que necesitan un auto con baúl: no sirve que vaya uno sin baúl). Si ninguno de los
-- demás lo toma, a gestión le suena "Nadie tomó el viaje" como en todos los viajes, y lo asigna a mano.
-- excluidos_vigentes (040) ahora devuelve siempre los marcados; la cola, "Tomar este viaje", el cartel y los avisos ya la
-- usan. Se ejecuta una sola vez en Supabase → SQL Editor.

create or replace function public.excluidos_vigentes(v public.viajes)
returns uuid[]
language sql
stable
as $$
  select v.choferes_excluidos
$$;
