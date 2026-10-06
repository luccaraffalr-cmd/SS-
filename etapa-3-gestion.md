# Arranque de la Etapa 3: gestión (plata y clientes)

> Para el chat nuevo. Antes de empezar, leé `CLAUDE.md` (cómo trabajamos, stack, estado) y en
> `especificacion-remiseria.md` las secciones **5** (importe y forma de pago), **6** (comisiones y cuenta
> corriente del chofer), **7** (clientes), **8 quater** (ideas para esta etapa) y **10 bis** (decisiones tomadas,
> que mandan sobre el resto).

## Estado al 6/10/2026
- Etapas 1 y 2 hechas. **SQL aplicados hasta el 024.** El próximo es `supabase/sql/025_…`.
- Funciones `usuarios` y `notificar` ya subidas a Supabase. Los avisos al chofer en la app (Firebase) los probó el
  usuario y **andan bien**.
- **Falta publicar en Netlify** (el usuario lo quiere hacer todo junto, cuando decida): contraseña propia al primer
  ingreso, alertas "no salió" / "sin aceptar", advertencia al "Terminar el día", link del pasajero con foto grande,
  DNI y alias. Todo está commiteado en local; **no hacer push a `main` sin que lo pida**.
- La app todavía **no la usa nadie en serio**: no hay datos reales que cuidar (pero igual no borrar nada sin preguntar).

## Lo que ya existe y tiene que ver con plata
- `viajes`: `importe`, `forma_pago` (`efectivo`, `transferencia_chofer`, `transferencia_duenio`, `cuenta_corriente`),
  `comision_porcentaje` (el % vigente al cargar el pago; no cambia después), `cuenta_id` / `cuenta_otro`
  (a qué cuenta corriente va), `pago_cargado_en` / `pago_cargado_por`. Estados `pago_pendiente` y `finalizado`.
- `cambios_pago`: registro de cada carga o corrección de pago (antes / después).
- `comisiones`: % por chofer (por defecto 20). La ven el admin y el propio chofer.
- `cuentas_corrientes`: lista de clientes y empresas "a cuenta" (nombre, tipo, teléfono, activo). **Sin saldos todavía.**
- `choferes_privado`: DNI y alias del chofer (no lo ven los otros choferes).
- Funciones SQL: `guardar_pago`, `finalizar_viaje`, `cargar_pago`, `corregir_pago` (ver `011_cuentas_corrientes.sql`).
- Pantallas: `FormPago.jsx` (importe + forma + cuenta), `CuentasCorrientes.jsx` (lista, solo admin),
  `MisViajes.jsx` (el chofer finaliza y carga el pago), `FormViaje.jsx` (gestión corrige el pago).
- **Los operadores no ven plata** (comisiones, saldos, cuentas): respetarlo en todo lo nuevo (RLS y pantallas).

## Qué incluye la etapa (según la especificación)
1. **Cuenta corriente de cada chofer**: movimientos automáticos al cargar el pago (efectivo o transferencia al chofer →
   el chofer debe la comisión; transferencia al dueño o cuenta corriente → la remisería le debe el neto), movimientos
   manuales del admin ("me pagó", "le pagué", ajustes con motivo), saldo al día. Cada chofer ve solo el suyo.
   Ojo con las correcciones de pago: el movimiento tiene que seguir al pago corregido.
2. **Resumen por chofer** filtrable por fechas: viajes por estado, recaudado por forma de pago, comisiones,
   movimientos manuales y saldo.
3. **Clientes guardados** (solo los que elija el dueño): nombre, teléfono y direcciones frecuentes; al cargar un viaje
   se buscan por nombre o teléfono y se autocompletan.
4. **Cuentas corrientes de clientes y empresas**: los viajes "a cuenta" suman deuda, gestión registra los pagos,
   saldo e historial por cliente.

## Lo primero: las planillas de la remisería (pregunta pendiente, sin respuesta todavía)
El usuario quiere, en un principio, **atar la gestión a las planillas que usa hoy la remisería** y que la app cargue
los números ahí. Antes de diseñar nada, preguntarle:
1. ¿Es **Google Sheets** o **Excel**? Si es Excel, ¿dónde está guardado (una compu, OneDrive…)?
2. ¿**Para qué** la usan: cada viaje, la cuenta de cada chofer, las cuentas corrientes de clientes? ¿Quién la llena y cada cuánto?
3. Que pase una **copia** (con datos cambiados o pocas filas): si es Google Sheets, Archivo → Descargar → Microsoft
   Excel (.xlsx), y dejarla en la carpeta del proyecto o en Descargas.

Con eso, proponer cómo conectarla: Google Sheets → la app escribe sola (función de Supabase con una cuenta de servicio
de Google); Excel en OneDrive → también se puede (Microsoft Graph); Excel solo en una compu → botón para bajar los
números. Y definir con él si la planilla sigue siendo "la principal" o pasa a ser una copia de lo que tiene la app.

## Ideas anotadas para esta etapa (a definir, ver 8 quater)
- **Pantalla final en el link del pasajero**: al terminar el viaje, "Viaje terminado", el precio y el alias al que
  transferir, elegido según las cuentas (si el chofer está en negativo, a una cuenta de gestión o a otro chofer con
  saldo a favor). Va **después** de tener la cuenta corriente de los choferes. Contablemente: si el pasajero de un
  viaje de A le transfiere a B, a A se le acredita su neto y B pasa a deber ese importe.

## Cómo trabajar con el usuario (además de lo de `CLAUDE.md`)
- No sabe programar: español rioplatense, palabras simples, botón por botón.
- Reglas de negocio nuevas: **preguntar antes de implementar**. Pero si cuenta una idea, primero confirmar si es para
  ahora o para después; no saltar a un formulario largo de decisiones.
- Anotar cada decisión en la sección 10 bis de la especificación.
- Probar en local (http://localhost:5173) antes de publicar; las pantallas nuevas se pueden verificar dibujando los
  componentes con datos de ejemplo en el navegador de prueba (sin sesión no hay datos por la seguridad de la base).
- Orden sugerido: planillas (entender) → cuenta corriente de choferes → resumen por chofer → clientes guardados →
  cuentas corrientes de clientes → conexión con la planilla → idea del alias en el link.
