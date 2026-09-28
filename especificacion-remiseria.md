# App de gestión de remisería — Especificación funcional

> Documento armado con el dueño de la remisería a partir de cómo funciona hoy el negocio.
> Describe **reglas de negocio**. Las decisiones técnicas quedan a criterio del desarrollador,
> salvo el stack indicado. Lo marcado como **[A CONFIRMAR]** tiene un comportamiento por
> defecto que se puede usar hasta hablarlo con el dueño.

---

## 1. Contexto

- Hoy los clientes piden viajes por **WhatsApp**. El dueño/coordinador los reenvía a un grupo de choferes y el viaje le toca al que llegó primero a la base.
- Hay unos **12 choferes**, cada uno con su celular Android y **auto fijo**.
- Para compartir la ubicación con el cliente se usa **Traccar**, pero se pierde la señal por varios minutos. No se sabe si es porque bloquean el celular o cierran la app.
- El objetivo es reemplazar el grupo de WhatsApp con una app de dos partes:
  - **Panel de gestión** (dueño y operadores)
  - **App de choferes**
- El uso principal es **desde el celular**, tanto en gestión como en la app de choferes.

**Stack:** Netlify (hosting) + Supabase (Postgres, Auth, Realtime, Storage, Edge Functions).

---

## 2. Roles y usuarios

| Rol | Puede |
|---|---|
| **Admin (dueño)** | Todo: usuarios, roles, comisiones, cuentas corrientes, reportes, configuración. |
| **Operador** | Cargar, editar, asignar y anular viajes; gestionar la cola; compartir seguimiento. **No ve plata** (comisiones, saldos, cuentas). |
| **Chofer** | Anunciarse o darse de baja de la cola, ver su viaje asignado, finalizarlo y cargar el pago, ver su propio saldo. |

- Los usuarios y roles se crean desde gestión.
- El perfil del chofer incluye nombre, teléfono, **foto del auto**, datos del auto (modelo, color, patente) y **% de comisión**.

---

## 3. Cola de choferes (base)

- El chofer toca **"Anunciarse"** y queda al **final** de la cola. No se verifica por GPS.
  - Lo puede tocar **aunque no esté en la base**. Por ejemplo, el coordinador lo llama y le dice "anunciate que tenés un viaje".
- El chofer puede **darse de baja solo** de la cola.
- Al **finalizar un viaje**, el chofer no vuelve solo a la cola: tiene que anunciarse de nuevo, y queda al final. El importe o la distancia del viaje no importan.
- **Anulación:** si gestión anula un viaje ya asignado, el chofer vuelve al **puesto 1** de la cola, aunque el que estaba atrás ya haya tomado otro viaje.
- **Gestión de la cola desde el panel:**
  - Botón **"Agregar a la cola"**: abre la lista de choferes que no están anunciados, y al tocar uno lo anuncia (entra al final, igual que si lo hubiera hecho él).
  - Botón **"Sacar"** al lado de cada chofer en la cola.
  - Opcional: poder mover a un chofer de posición.

---

## 3 bis. Estados del chofer: conectado, yendo, en cola

### Flujo del chofer
1. **Abre la app → Conectado** (automático, sin tocar nada). Significa solo que tiene la app abierta, **no que esté trabajando**.
2. Cuando sale para la base toca **"Yendo"** → avisa que está en camino a trabajar.
3. Cuando llega a la base toca **"Anunciarse"** → entra al final de la **cola**.
4. Para dejar de trabajar toca **"Desconectarme"**.

### Estados
| Estado | Significado | Quién lo ve |
|---|---|---|
| **Desconectado** | No está usando la app. | Gestión |
| **Conectado** | Abrió la app, todavía no trabaja. | **Solo gestión** |
| **Yendo** | En camino a la base. | Gestión y choferes |
| **En cola** | Anunciado en la base, con su posición. | Gestión y choferes |
| **En viaje** | Tiene un viaje asignado. | Gestión y choferes |

- **"Yendo" no reserva lugar en la cola.** La cola sigue siendo por orden de llegada (orden en que se anuncian).
- La asignación automática toma **solo a los que están en cola**. Gestión sí puede asignar a mano un viaje a un chofer que está "Yendo" (o en cualquier estado).
- Se puede tocar "Anunciarse" sin haber pasado por "Yendo" (ej. el coordinador lo llama y le dice que se anuncie).
- **No puede desconectarse con un viaje asignado sin finalizar.** Primero lo finaliza.
- Gestión puede cambiar el estado de cualquier chofer.

### Qué ve el chofer (en cualquier estado)
- Sus propios viajes: historial, viajes con pago pendiente (para cargarlos) y programados que tiene asignados.
- **Los viajes esperando chofer y los programados próximos**, para que un chofer que no está trabajando vea que hace falta gente y salga a trabajar.
- De esos viajes ajenos ve solo lo necesario (hora, zona de origen y destino). **Los datos del cliente** (nombre, teléfono, dirección exacta) **se muestran solo cuando el viaje se le asigna**.
- La cola y quién está "Yendo".
- Ver un viaje no le da derecho a elegirlo: cuando se anuncia, se le asigna el que corresponda según las reglas de asignación.

### Choferes ocultos
- En el perfil del chofer, gestión puede activar la opción **"Oculto"**.
- El chofer oculto **ve todo** lo que ve cualquier chofer (viajes, cola, quién está yendo).
- **Los demás choferes no lo ven en ningún lado** (ni en la cola, ni "Yendo", ni en viaje). Gestión lo ve siempre.
- **No entra en la cola ni recibe asignaciones automáticas.** Solo recibe viajes que gestión le asigna a mano (ej. choferes de refuerzo o que trabajan de vez en cuando).
- En la app no tiene botón de "Anunciarse" (sí de "Yendo" y "Desconectarme", que solo ve gestión).
- Comisión, cuenta corriente, notificaciones y cierre de viaje funcionan igual que para cualquier chofer.
- **Viajes asignados a un chofer oculto:** para los demás choferes el viaje aparece como **"No disponible"**. Gestión y el chofer oculto ven el estado real.

### Cortes de señal
- El estado se guarda en la base de datos, así que se sigue viendo aunque el chofer cierre la app o apague el celular.
- Junto a cada chofer se muestra **"último reporte hace X min"**.
- Si un chofer **Yendo, En cola o En viaje** pasa más de X minutos sin reportar (configurable, ej. 5), **no cambia de estado**: aparece una **alerta "sin señal"** en gestión para que lo llamen.
- Si un chofer que solo estaba **Conectado** (no trabajando) cierra la app, pasa a **Desconectado** sin alerta.

---

## 4. Viajes

### 4.1 Datos del viaje
Cliente (guardado o suelto), teléfono, origen, destino, observaciones, **hora de asignación** y **chofer elegido** (opcional).

- **El precio no se carga al crear el viaje.** Se carga siempre al finalizar (ver sección 5).
- Viajes con espera, ida y vuelta, etc.: no tienen lógica especial. Se aclaran en observaciones y se reflejan en el importe final.

### 4.2 Hora de asignación
**Todos los viajes tienen una hora de asignación:**
- **Viaje programado:** gestión carga la hora de presentación en la dirección del cliente (ej. 15:00) y la hora de asignación, que por defecto es 30 minutos antes (14:30) y es editable.
- **Viaje inmediato:** la hora de asignación es **el momento en que se carga** en la app.

Un viaje es **asignable** cuando su hora de asignación ya llegó o ya pasó.

### 4.3 Reglas de asignación

**Orden de prioridad entre viajes:** si hay varios viajes asignables y un solo chofer, se asigna **el que tenga la hora de asignación más temprana**.

**Regla A — Un viaje se vuelve asignable:** se asigna automáticamente al **primero de la cola**. Si la cola está vacía, queda **sin chofer** esperando.

**Regla B — Se anuncia un chofer:** si hay viajes asignables sin chofer, se le asigna **en ese momento** el de hora de asignación más temprana, sin pasar por la cola. Si no hay ninguno, entra a la cola.
- Los programados no se asignan *solo* a su hora exacta: se asignan a esa hora **o en cualquier momento posterior** en que haya un chofer disponible.

**Regla C — Asignación manual:** gestión puede asignar cualquier viaje a cualquier chofer, cambiar el chofer asignado o **dejar el viaje sin chofer**.

**Regla D — Chofer elegido al cargar el viaje:**
- Hay clientes que piden un chofer en particular. Al cargar el viaje, gestión puede elegir el chofer.
- Ese viaje **queda asignado a ese chofer** aunque no esté en la cola y aunque esté ocupado. La cola no lo toma.
- En gestión estos viajes se muestran **resaltados en naranja**, para saber que tienen chofer fijo.
- Gestión puede **cambiarlo a otro chofer** o **dejarlo sin chofer**. Si lo deja sin chofer, pasa a ser un **viaje común** y entra en las reglas A y B.
- **[A CONFIRMAR]** Si el chofer elegido estaba en la cola cuando se le asigna el viaje, ¿sale de la cola? *Por defecto: sí, sale de la cola cuando le toca hacer ese viaje (a su hora de asignación).*

**Regla E — Cola:** cuando un chofer recibe un viaje, sale de la cola.

**Ejemplo que tiene que funcionar:**
- Hay un programado con presentación 15:00 y asignación 14:30. Hay un solo chofer en la cola.
- A las 14:29 entra un viaje inmediato (asignación 14:29) → se le asigna al único chofer.
- A las 14:30 el programado se vuelve asignable, pero la cola está vacía → queda sin chofer.
- A las 14:45 se anuncia otro chofer → se le asigna el programado en ese momento.

**Alertas en gestión:** los viajes asignables sin chofer tienen que verse de forma muy visible, sobre todo los programados cerca de su hora de presentación.

**Notificación al chofer:** cuando se le asigna un viaje, le llega una **notificación push al celular, con sonido**.

**El chofer no puede rechazar viajes.** Solo gestión anula o reasigna.

### 4.4 Estados del viaje

| Estado | Significado |
|---|---|
| **Sin chofer** | Asignable pero todavía sin chofer (o programado cuya hora de asignación todavía no llegó). |
| **Asignado** | Tiene chofer y todavía no lo finalizó. |
| **Pago pendiente** | El chofer finalizó el viaje pero eligió "cargar pago después". |
| **Finalizado** | Viaje hecho y con pago cargado. |
| **Fallido** | El chofer lo marcó como fallido (ej. el cliente no estaba). |
| **Anulado** | Anulado desde gestión. |

- **En gestión se ven TODOS los viajes con su estado**, con filtros por estado, chofer y fecha.
- Los viajes en **Pago pendiente** tienen que destacarse, para que el admin vea qué choferes deben cargar pagos.

### 4.5 Flujo del chofer al terminar
El chofer toca **"Finalicé"** y elige una de tres opciones:
1. **Cargar pago:** ingresa importe y forma de pago → estado **Finalizado**.
2. **Cargar después:** estado **Pago pendiente**. Después puede cargarlo desde una lista de "mis viajes sin pago".
3. **Fallido:** estado **Fallido**. No genera importe ni comisión. **[A CONFIRMAR]** ¿Tiene que cargar un motivo? *Por defecto: motivo opcional.*

En los tres casos, el chofer queda libre y se tiene que anunciar de nuevo para volver a la cola.

- **[A CONFIRMAR]** Si el viaje es fallido, ¿el chofer vuelve al puesto 1, como con una anulación, o al final? *Por defecto: al final, como un viaje normal.*

---

## 5. Importe y forma de pago

- El **importe se carga siempre al finalizar** (lo carga el chofer).
- Formas de pago:
  1. Efectivo (cobra el chofer)
  2. Transferencia al chofer
  3. Transferencia al dueño
  4. Cuenta corriente del cliente o empresa
- Gestión puede **cargar o corregir** importe y forma de pago de cualquier viaje. Los cambios quedan registrados.

---

## 6. Comisiones y cuenta corriente del chofer

La liquidación es **situacional**: a veces el dueño le paga al chofer en el momento, a veces queda a cuenta, a veces el chofer le debe al final del día. Por eso **no hay fecha fija de rendición**. Cada chofer tiene una **cuenta corriente** con saldo acumulado.

- Comisión **configurable por chofer**, por defecto **20%**. Se guarda el % vigente en cada viaje, para que un cambio de comisión no altere el historial.
- **Movimientos automáticos al cargar el pago de un viaje:**
  - Efectivo o transferencia al chofer → el chofer le debe al dueño la **comisión** (20%).
  - Transferencia al dueño o cuenta corriente → el dueño le debe al chofer el **neto** (80%).
- **Movimientos manuales** (solo admin), en cualquier dirección y en cualquier momento:
  - "El chofer me pagó $X"
  - "Le pagué al chofer $X"
  - Ajustes, con motivo.
- **Saldo neto** en tiempo real: quién le debe a quién y cuánto.
- **Resumen por chofer** (filtrable por fechas): viajes por estado, total recaudado por forma de pago, comisiones, movimientos manuales y saldo.
- El chofer ve **su propio** saldo y movimientos, pero no los de otros.

---

## 7. Clientes

- Se guardan **solo los que el dueño elija**: nombre, teléfono y direcciones frecuentes.
- Al cargar un viaje, se busca el cliente por nombre o teléfono y se autocompletan los datos.
- **Cuenta corriente de clientes y empresas:** los viajes pagados "a cuenta" suman deuda, y gestión registra los pagos. Saldo e historial por cliente.

---

## 8. Seguimiento en vivo (etapa 2)

- En gestión, cada viaje **asignado** tiene un botón **"Compartir"** que genera un **link único** para reenviar por WhatsApp (idealmente con la opción de compartir nativa del celular).
- El link muestra:
  - **Mapa con la ubicación del auto en tiempo real**
  - **Foto del auto**, modelo, color, patente y nombre del chofer
- El cliente **no instala nada** ni se loguea.
- El link **se desactiva** cuando el chofer finaliza el viaje o gestión lo anula.
- En gestión también: **mapa con todos los choferes** en vivo.

### Problema actual a resolver
Hoy la ubicación "desaparece" por varios minutos. Hay que diseñar para que **no pase ni con la pantalla bloqueada ni con la app en segundo plano**.

- **No es obligatorio seguir con Traccar** ni ninguna tecnología en particular. Se puede hacer app Android, web o una combinación. El criterio es **que funcione de forma confiable**.
- Referencia técnica: una web/PWA en el navegador **no puede** mandar ubicación de forma confiable con la pantalla bloqueada en Android. Opciones razonables:
  - App Android nativa o híbrida (ej. Capacitor) con **servicio en primer plano** de ubicación.
  - Transitorio: seguir con Traccar Client y que mande los datos a un endpoint propio en Supabase.
- En cualquier caso, hay que **desactivar la optimización de batería** para la app en cada celular. Conviene que la app guíe al chofer para hacerlo.
- Gestión debería ver el **"último reporte"** de ubicación de cada chofer (ej. "hace 3 min") para detectar cortes.

---

## 8 bis. Idea a futuro: pedido de viajes por el pasajero (a evaluar)

> No entra en las primeras etapas. Queda anotado para definirlo más adelante con el dueño.

- **Solo pueden pedir clientes guardados.** Cada cliente tiene su **link personal** (único, generado desde gestión en su ficha, para mandárselo por WhatsApp). El link ya lo identifica, así que no necesita loguearse, y trae precargados sus datos y direcciones frecuentes.
  - Gestión puede **desactivar o regenerar** el link de un cliente (por ejemplo, si lo compartió o dejó de ser cliente).
- Pensado sobre todo para **programados**. Los viajes inmediatos siguen entrando por WhatsApp, como hoy.
- Datos del formulario: origen, destino, fecha y hora de presentación, observaciones (nombre y teléfono ya vienen del cliente).
- **El pedido no entra directo como viaje.** Llega a gestión como **"Solicitud"** y el dueño u operador la **confirma** (se convierte en viaje programado normal) o la **rechaza**.
  - **Al confirmar**, gestión define **con cuántos minutos de anticipación se asigna el chofer** (ej. 10, 30 o los que considere). La hora de asignación del viaje se calcula así: hora de presentación menos esos minutos.
  - El campo viene precargado con el valor por defecto (30 min) y conviene tener botones rápidos (10 / 20 / 30 / 45) además de poder escribir cualquier valor.
- Al confirmar o rechazar, gestión le avisa al cliente por WhatsApp (al principio a mano; más adelante se puede automatizar).
- Notificación en gestión cuando entra una solicitud nueva.
- **Anticipación mínima para pedir: 1 hora.**
- **Seguridad del link:** quien tenga el link puede usarlo, porque funciona como una llave. Lo cubren tres cosas:
  1. Toda solicitud requiere confirmación de gestión.
  2. El link se puede desactivar o regenerar en cualquier momento.
  3. **La confirmación siempre se envía al teléfono registrado del cliente**, nunca a un número cargado en el formulario. Si el pedido lo hizo otra persona con su link, el cliente real se entera.
  4. **Mejora opcional:** pedir un **PIN de 4 dígitos** por cliente (lo define gestión y se lo pasa al cliente) antes de enviar la solicitud.

---

## 8 ter. Idea a futuro: respuesta automática por WhatsApp (a evaluar)

> No entra en las primeras etapas.

- Objetivo: que cuando un cliente escribe al WhatsApp de la remisería, un bot lo salude y le pida los datos del viaje:
  1. ¿Para qué hora necesita el viaje?
  2. ¿A qué dirección se envía el auto?
  3. ¿Hasta dónde va? (opcional, puede no contestar)
- Con esas respuestas, el bot crea una **"Solicitud"** en gestión (la misma de la sección 8 bis), que el dueño confirma o rechaza. El bot **no confirma viajes solo**.
- Si el cliente escribe algo que el bot no entiende, o pide hablar con alguien, pasa a atención manual.
- **Requisito técnico:** usar la **API oficial de WhatsApp (WhatsApp Cloud API de Meta)**. No usar librerías no oficiales que automatizan WhatsApp Web, porque Meta puede **bloquear el número**. Revisar requisitos de verificación, costos vigentes y si el número actual puede seguir usándose en el celular al mismo tiempo.
- Mientras tanto, se usa el **mensaje de bienvenida automático de WhatsApp Business** (gratis, sin desarrollo).
- **Integración:** el bot tiene que ser **parte de esta misma app** (por ejemplo, un webhook en Supabase Edge Functions que recibe los mensajes de WhatsApp y crea las solicitudes). No es un sistema aparte.
- **Costos (a verificar al momento de desarrollarlo):** el acceso a la API es gratis y los mensajes entrantes también. Desde el 1/10/2026 las respuestas se cobran por mensaje, con un cupo gratis mensual por número (según varias fuentes, 1.000 mensajes; confirmar en la página oficial de precios de Meta). Conectarse **directo con Meta** es más barato que usar un intermediario (Twilio, Wati, etc.). Conviene que el bot use **pocos mensajes por pedido** (ej. un solo mensaje con las 3 preguntas).

---

## 9. Etapas sugeridas

1. **Etapa 1 — Operación:** usuarios y roles, perfiles de chofer, cola, carga de viajes, reglas de asignación, notificaciones, flujo de finalización, listado de todos los viajes con estados.
2. **Etapa 2 — Seguimiento:** ubicación confiable en segundo plano, link compartible, mapa de flota.
3. **Etapa 3 — Plata y clientes:** cuenta corriente de choferes, comisiones, resúmenes, clientes guardados, cuentas corrientes de clientes y empresas.
4. **Etapa 4 (a evaluar):** link para que el pasajero pida viajes programados (sección 8 bis).
5. **Etapa 5 (a evaluar):** bot de WhatsApp que toma los datos del viaje y crea la solicitud (sección 8 ter).

---

## 10. Requisitos técnicos a tener en cuenta

- La asignación por hora de asignación tiene que ocurrir **en el servidor** (función programada o cron). No puede depender de que alguien tenga la app abierta.
- Evitar condiciones de carrera: dos viajes asignados al mismo chofer, o dos choferes al mismo viaje. La asignación tiene que ser atómica (por ejemplo, con una función en la base).
- Cola y viajes en **tiempo real** en gestión y en la app del chofer.
- Registro (log) de quién asignó, reasignó, anuló o corrigió cada cosa y cuándo.

---

## 10 bis. Decisiones tomadas durante el desarrollo

> Reemplazan lo que diga el resto del documento sobre el mismo tema.

- **(2026-09-28) Estados del chofer simplificados a 4, sin cambios automáticos.** Reemplaza la sección 3 bis:

  | Estado | Significado | Cómo se entra |
  |---|---|---|
  | **Fuera de servicio** | No está trabajando. | "Terminar el día" o lo pone gestión. |
  | **Libre** | Trabajando pero no anunciado (yendo a la base, volviendo de un viaje). | "Empezar a trabajar", o al terminar un viaje. |
  | **En cola** | Anunciado en la base, con su puesto. | "Anunciarme" o gestión "Agregar a la cola". |
  | **En viaje** | Tiene un viaje asignado. | Al asignarle un viaje. |

  - Los estados **no cambian solos por tiempo**: no hay alerta "sin señal" ni desconexión automática, y abrir la app no cambia el estado. Es normal que un chofer tarde mucho en volver a la base.
  - "Último reporte hace X min" se muestra como dato informativo: es la última vez que el chofer hizo algo en la app (cambió su estado). Tener la app abierta no cuenta, y los cambios que hace gestión tampoco.
  - Los choferes ven la cola, quién está Libre y quién En viaje.
- **(2026-09-28) Cola ordenable "tipo Spotify":** en gestión se arrastra a cada chofer al puesto que se quiera.
- **(2026-09-28) Asignación con aceptación del chofer.** Reemplaza "El chofer no puede rechazar viajes" (4.3):
  - **Oferta automática:** el viaje se le ofrece al primero de la cola, que tiene **3 minutos** para aceptar (a revisar).
    - **No contesta:** el viaje pasa al siguiente y él conserva su lugar en la cola.
    - **Rechaza:** el viaje pasa al siguiente y él **sale de la cola** (queda Libre; si rechaza es porque pasó algo).
    - No se le vuelve a ofrecer el mismo viaje.
  - **Asignación manual (gestión):** el chofer la acepta al recibirla (sin tiempo límite) y, cuando llega la hora o termina el viaje que está haciendo, toca **"Salir a hacer el viaje"**. Si la rechaza, el viaje **vuelve a gestión** (no se asigna solo).
  - Gestión puede asignar a un chofer que está **En viaje**: queda como su **próximo viaje**.
  - Si gestión le saca un viaje que ya estaba haciendo (reasigna o anula), el chofer vuelve al **puesto 1**.
  - Si todos están ocupados, el viaje que espera se le ofrece al **primero que se anuncie** (como la regla B).
- **(2026-09-28) Prioridad entre viajes esperando:** primero los marcados **⭐ Priorizar** por gestión, después los **programados**, después los **inmediatos**; dentro de cada grupo, el de hora de asignación más temprana.
- **(2026-09-28) Tema a confirmar n.º 1:** el chofer elegido para un programado **sigue en la cola** hasta su hora (puede rechazar ofertas si sabe que no llega). Destino: opcional, pero se le muestra al chofer en la oferta.
- **(2026-09-28) Choferes entran con un usuario** (ej. `juanperez`), no necesitan email.
- **Ubicación (Etapa 2):** integrar a esta app el sistema de ubicación que hoy se usa para mandar a los clientes (Traccar), y a futuro que la app del chofer reporte la ubicación sola.

---

## 11. Temas a confirmar con el dueño

| # | Tema | Comportamiento por defecto |
|---|---|---|
| 1 | Chofer elegido que estaba en la cola: ¿sale de la cola? | ✅ Resuelto: sigue en la cola hasta su hora (ver 10 bis) |
| 2 | Viaje fallido: ¿motivo obligatorio? | ✅ Resuelto (28/9/2026): opcional |
| 3 | Viaje fallido: ¿el chofer vuelve al puesto 1 o al final? | ✅ Resuelto (28/9/2026): **vuelve al puesto 1** |
