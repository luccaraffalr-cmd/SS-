# Arranque de la Etapa 3: gestión (plata y clientes)

> Para el chat nuevo. Antes de empezar, leé `CLAUDE.md` (cómo trabajamos, stack, estado) y en
> `especificacion-remiseria.md` las secciones **5** (importe y forma de pago), **6** (comisiones y cuenta
> corriente del chofer), **7** (clientes), **8 quater** (ideas para esta etapa) y **10 bis** (decisiones tomadas,
> que mandan sobre el resto).

## Estado al 6/10/2026
- Etapas 1 y 2 hechas. **SQL aplicados hasta el 027** (19/10). El próximo es `supabase/sql/028_…`.
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
   se buscan por nombre o teléfono y se autocompletan. **Hecho el 2/11/2026** (SQL 050, pestaña "Clientes"; ver 10 bis):
   se crean a mano, se eligen con un buscador, con nota fija, cuenta corriente y viajes de siempre.
4. **Cuentas corrientes de clientes y empresas**: los viajes "a cuenta" suman deuda, gestión registra los pagos,
   saldo e historial por cliente.

## La planilla de la remisería (vista el 9/10/2026)
Es un **Google Sheets** ("Senda Segura Formulario 2 (respuestas)"; hay una copia .xlsx en `Descargas`, **con datos
reales: no copiarla al repo, que es público**). Los choferes cargan **cada viaje en un formulario de Google** y el dueño
(el papá del usuario) revisa y anota los pagos a mano. Está muy bien armada; pasarla a la app es **muy a futuro**.
- **"Respuestas de formulario 1"** (lo que llena el formulario, ~50.000 filas desde 2023): A Marca temporal, B Chofer,
  C Fecha, D Cliente (texto libre; muchas veces un n.º de lote), E Origen, F Destino, G Forma Pago (`Efectivo` o
  `Cuenta Corriente`), H Cliente Cuenta Corriente (nombre de la lista), I Importe, J Demora, K Peaje, L Gas/Nafta.
  Todo lo demás se calcula desde acá con `SUMIFS` por nombre de chofer (B) y fecha (C).
- **Una hoja por chofer** (A2 = el nombre tal cual aparece en B; a veces es auto + chofer, ej. "Cronos Gris X"): una fila por
  día con viajes, importe, demora, peaje, total sin peaje (= importe + demora), comisión (= total sin peaje × %; **el peaje no
  paga comisión**), gas/nafta, **"Efectivo"** (única columna manual: lo que se pagan; + el dueño le pagó al chofer o le cobra
  algo, − el chofer le pagó al dueño), cuenta corriente (importe + demora + peaje de sus viajes a cuenta) y saldo
  (= Efectivo + comisión − cuenta corriente + saldo anterior; **positivo = el chofer le debe a la remisería**).
  Casos especiales: autos de otro dueño (lo que queda después de comisión y nafta se reparte 50/50 con el dueño del auto),
  un auto con 15% de comisión, y choferes que cobran el 2% de lo que factura otro chofer (referidos).
- **"Cuenta Corriente"**: dos columnas por cliente/empresa: "Facturación" (sale sola de los viajes con ese nombre en H) y
  "Pagos" (manual). Fila 1 = saldo de cada uno (con algunos ajustes fijos en la fórmula). ~33 clientes, incluido "Otro".
- **"Comisiones"** (% por chofer), **"Facturacion por dia"**, **"Facturacion Mensual"** (comisiones en pesos y en dólar
  blue) y **"TC"** (cotización del blue).

**Decidido (9/10):** la **app reemplaza al formulario** y la planilla sigue siendo **la principal para la plata**: al cargar el
pago, la app escribe la misma fila en "Respuestas de formulario 1". Ver 10 bis de la especificación (formas de pago, un
nombre por chofer, qué queda de la etapa).

Hecho (9/10): SQL `025_planilla.sql` (aplicado el 13/10; al pegarlo se le agregaron las 32 cuentas corrientes con los
nombres de la planilla, que no van al repo), función `planilla` (subida), demora/peaje/nafta en `FormPago`, "Nombre en la
planilla" en `DatosChofer`, `EstadoPlanilla` en el viaje y aviso rojo en Viajes si algo no se pudo pasar.
**Probado el 13/10 con la copia** ("PRUEBA app - Senda Segura"; `PLANILLA_ID` apunta a la copia): viaje #154 de `p2` con
nombre en la planilla "Alejandro". Se agregó la fila (52827) y la columna M "N.º viaje app" (la hoja tenía solo A–L: la función
agrega la columna sola), la corrección actualizó la misma fila, y la hoja "Alejandro" y "Cuenta Corriente" (Priva) lo sumaron
bien. Fechas y números quedan como los del formulario. La planilla está en locale es_MX.
**Arreglado el 3/11** (las hojas de los choferes no sumaban los viajes de la app): casi ningún chofer tenía "Nombre en la
planilla" y se anotaban con el nombre del usuario, que no coincide con la celda A2 de su hoja. SQL 053 + "Su hoja en la
planilla" como lista en `DatosChofer` (la función `planilla` con `{ accion: 'hojas' }`, solo gestión, devuelve las A2 de las
hojas que en A1 dicen "Nombre del Chofer"). Los nombres de cada chofer se cargaron con un SQL aparte (no va al repo) y se
reescribieron las 618 filas. La función ahora escribe todo junto (una corrección y un agregado por vuelta, de a 100) y agrega
las filas nuevas al final (antes las metía desde la fila 2: en la copia, las filas 2 a 619 son de la app; eso corrió la
fórmula de "Comisiones" a `B620:B1666`, no pasa en la de verdad). La hoja "Brian" tiene días solo hasta el 26/3/2026: el
dueño tiene que estirarla.
**Arreglado el 4/11 en la copia** (venía así de la planilla original, no lo rompió la app; la de verdad tiene lo mismo):
- "Comisiones": la columna A era `SORT(UNIQUE(...))` de las primeras 1047 respuestas (junio de 2023), con 16 choferes; los
  demás daban #N/A en la comisión (C2 de su hoja) y en todo lo que depende de ella (saldo, ganancia, total dueño auto, y
  el saldo de Federico, que resta el 2% de Alberto, Diego Cantalejo, etc.). Ahora es una **lista fija** con las 67 hojas de
  choferes, todos con 20% (los 16 ya estaban con 20%; los dos 15% de las filas 24 y 25 no tenían chofer al lado). **Al armar
  la hoja de un chofer nuevo, hay que agregarlo en "Comisiones".**
- "TD Comision" (tabla dinámica por fecha y chofer): no repetía la fecha, y "Facturacion por dia" (`SUMIFS` por fecha) sumaba
  solo al primer chofer de cada día. Ahora repite la fecha; verificado: el total del día = la suma de las hojas. Fórmulas de
  E:F estiradas hasta la fila 21291.
- "Brian": 1000 días más (hasta el 20/12/2028, como las demás).
- (6/11) "Marca temporal" de las 618 filas que la app metió arriba (2 a 619): tomaron el formato del encabezado y se veían
  como un número (46314,85956). Ahora tienen el mismo formato de fecha y hora que el resto (`m/d/yyyy h:mm:ss`, el del
  formulario). Las que la app agrega al final ya salían bien.
- Se hizo con `supabase/functions/arreglar-planilla` (no queda subida; cómo usarla, arriba de todo en el archivo). **Al pasar
  a la de verdad, correrla también ahí** (con `estirar` para las hojas que estén cortas).
- Sin tocar, a preguntarle al dueño: en "Federico", la columna "Ojeda Armando" (2%) apunta 1000 filas más abajo de la fecha
  (da siempre 0), y en "Alberto", "Comision Dario" usa la hoja vieja "Dario" (vacía; ¿debería ser "Bianchi Dario"?).
- Visto en la base: hay viajes cobrados con importe $0, $1 o $2 (Roberto Casco, Alberto Berrastro, Federico Yabel, Victor
  Gutierrez y otros, desde el 19/10): en la planilla suman eso.

**6/11: no se pasa nada a la planilla oficial. La copia ("PRUEBA app - Senda Segura") pasa a ser la planilla de la app**
(la nuestra): la app sigue escribiendo todo ahí y se la va a personalizar. La oficial queda como está, con el formulario de
Google (el dueño pidió pasar solo a Alejandro y enseguida se descartó). Los pasos de abajo ya no van, salvo que se decida
otra cosa.

~~Para pasar a la planilla de verdad~~ (ya no va, 6/11):
1. ~~Borrarle "Alejandro" del "Nombre en la planilla" a `p2`~~ (hecho el 19/10). No usar choferes de prueba después del cambio.
2. Que el usuario comparta la planilla de verdad con `firebase-adminsdk-fbsvc@senda-segura.iam.gserviceaccount.com` (editor).
3. `npx.cmd supabase secrets set PLANILLA_ID=<id de la de verdad> --project-ref yomjqdbaatydpvazkvvg`. Los viajes que ya
   se anotaron en la copia no pasan a la de verdad (la función lo controla con `planilla_envios.planilla`).
4. Publicar en Netlify (las pantallas nuevas) y avisar a cada chofer que deje de usar el formulario.
5. Pendiente del dueño: qué va en "Cliente Cuenta Corriente" para "Transferencia al dueño" (hoy: "Transferencia al dueño").

Cómo está hecho:
- Función de Supabase `planilla` con la cuenta de servicio de Google que ya existe (`FIREBASE_CUENTA`, proyecto
  `senda-segura`): hay que activar la Google Sheets API en ese proyecto y compartir la planilla con el `client_email` como
  editor. ID de la planilla en un secret (`PLANILLA_ID`), no en el repo.
- Cola en la base (viajes a pasar a la planilla) con disparador al cargar/corregir el pago + reintento por cron; columna M
  "N.º viaje app" en la hoja de respuestas para encontrar la fila al corregir.
- En la app: demora, peaje y gas/nafta al cargar el pago; "nombre en la planilla" en la ficha del chofer; cuentas corrientes
  con el mismo nombre que en la planilla.
- **Probar con una copia de la planilla** (Archivo → Hacer una copia), nunca escribir pruebas en la de verdad.
- Durante el cambio conviven: los choferes con la app dejan de usar el formulario; los demás siguen con el formulario.

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
- Orden (cambiado el 9 y el 14/10): conexión con la planilla (hecha). **Clientes guardados: descartado** el 14/10, pero
  **hechos el 2/11** (los pidió el dueño para mandarle el link solo al cliente por WhatsApp). La cuenta corriente
  de choferes, el resumen y las cuentas de clientes en la app quedan para cuando se pase la planilla a la app (muy a futuro).
  La idea del alias en el link necesita saber el saldo del chofer: se podría leer de su hoja en la planilla.
- **Uso en paralelo (14/10):** la app se empieza a usar de verdad escribiendo en la **copia**, mientras siguen el formulario y
  la planilla de verdad. Se pasa a la de verdad cuando esté probado (pasos de arriba). Para eso hay que publicar en Netlify.
