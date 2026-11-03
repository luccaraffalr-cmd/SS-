-- Arreglo urgente del 050 (2/11/2026): con dos vínculos de viajes a cuentas_corrientes (cuenta_id y cuenta_sugerida_id),
-- la consulta de los viajes ("cuenta:cuentas_corrientes(nombre)") daba "more than one relationship was found" y no
-- cargaban los viajes (tampoco se pasaban los pagos a la planilla). Se saca el vínculo de cuenta_sugerida_id: queda
-- como un número común. Si se borra una cuenta, los clientes que la tenían quedan sin cuenta (on delete set null del 050)
-- y eso ya limpia la cuenta sugerida de sus viajes sin cobrar (disparador clientes_cambio_de_cuenta).
-- Se ejecuta una sola vez en Supabase → SQL Editor.

alter table public.viajes drop constraint viajes_cuenta_sugerida_id_fkey;

notify pgrst, 'reload schema';
