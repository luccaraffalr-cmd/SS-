export const NOMBRE_ESTADO_VIAJE = {
  sin_chofer: 'Sin chofer',
  ofrecido: 'Esperando que acepte',
  asignado: 'Asignado',
  pago_pendiente: 'Pago pendiente',
  finalizado: 'Finalizado',
  fallido: 'Fallido',
  anulado: 'Anulado',
}

export const FORMAS_PAGO = {
  efectivo: 'Efectivo',
  transferencia_chofer: 'Transferencia al chofer',
  transferencia_duenio: 'Transferencia al dueño',
  cuenta_corriente: 'Cuenta corriente',
}

// "$ 12.500"
export function dinero(n) {
  return '$ ' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })
}

// Lo que se ve más grande en cada viaje (pedido del 19/10/2026): el cliente o, si no tiene, el origen. El horario va abajo.
export const tituloViaje = (v) => v.cliente_nombre || v.origen

// Debajo del título: el recorrido si el título es el cliente; si el título ya es el origen, solo el destino.
export function recorridoDebajo(v) {
  if (v.cliente_nombre) return v.origen + (v.destino ? ' → ' + v.destino : '')
  return v.destino ? '→ ' + v.destino : ''
}

// Lo que pagó el pasajero: importe + demora + peaje (la nafta es un gasto del chofer, no se le cobra).
export function totalCobrado(v) {
  return Number(v.importe ?? 0) + Number(v.demora ?? 0) + Number(v.peaje ?? 0)
}

// Convierte lo que escribe la persona ("12.500", "12500,50") en número; null si no es válido.
export function leerImporte(texto) {
  const limpio = String(texto).trim().replace(/\$/g, '').replace(/\s/g, '')
  if (!limpio) return null
  // "12.500,50" → 12500.50 ; "12500.5" → 12500.5
  const normal = limpio.includes(',') ? limpio.replace(/\./g, '').replace(',', '.') : limpio.replace(/\.(?=\d{3}(\D|$))/g, '')
  const n = Number(normal)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// DNI: se guarda sin puntos ("30.123.456" → "30123456"). Si no son solo números, queda como se escribió.
export function soloNumerosDni(texto) {
  const limpio = String(texto ?? '').trim()
  const numeros = limpio.replace(/[.\s-]/g, '')
  return /^\d+$/.test(numeros) ? numeros : limpio
}

// "30123456" → "30.123.456"
export function formatoDni(dni) {
  return /^\d+$/.test(dni ?? '') ? Number(dni).toLocaleString('es-AR') : dni
}

const dosDigitos = (n) => String(n).padStart(2, '0')

// "14:30"
export function hora(fecha) {
  const d = new Date(fecha)
  return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`
}

// "2026-09-28" en hora local (para los campos de fecha)
export function fechaLocal(fecha = new Date()) {
  const d = new Date(fecha)
  return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`
}

// "lun 28/9"
export function fechaCorta(fecha) {
  const d = new Date(fecha)
  const dia = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d.getDay()]
  return `${dia} ${d.getDate()}/${d.getMonth() + 1}`
}

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre',
  'Octubre', 'Noviembre', 'Diciembre']

export const DIAS_GRILLA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

// Las 6 semanas que muestra la grilla de un mes (empieza en lunes).
export function diasDeLaGrilla(mes) {
  const primero = new Date(mes.getFullYear(), mes.getMonth(), 1)
  const corrimiento = (primero.getDay() + 6) % 7 // lunes = 0
  return Array.from({ length: 42 }, (_, i) => new Date(mes.getFullYear(), mes.getMonth(), 1 - corrimiento + i))
}

// "2026-10-15" → fecha a mediodía (para no correrse de día por la zona horaria).
export const deFechaLocal = (texto) => new Date(texto + 'T12:00')

// Une un "2026-09-28" y un "15:00" (hora local) en una fecha.
export function unirFechaHora(fecha, horaTexto) {
  const [a, m, d] = fecha.split('-').map(Number)
  const [h, min] = horaTexto.split(':').map(Number)
  return new Date(a, m - 1, d, h, min)
}

// Un viaje sin chofer cuya hora de asignación ya llegó: hay que conseguirle chofer.
export function esAsignableSinChofer(viaje, ahora = Date.now()) {
  return viaje.estado === 'sin_chofer' && new Date(viaje.hora_asignacion).getTime() <= ahora
}

// ¿Gestión tiene que ocuparse ya de este viaje? Llegó su hora de asignación y:
//   'sin_chofer'  → no tiene chofer;
//   'sin_aceptar' → se lo asignaron a mano (o es de chofer fijo) y todavía no lo aceptó;
//   'no_salio'    → lo aceptó pero todavía no tocó "Salir a hacer el viaje".
// Las ofertas automáticas (las de la cola) no cuentan: se están ofreciendo en ese momento.
export function problemaDelViaje(viaje, ahora = Date.now()) {
  if (viaje.iniciado_en || new Date(viaje.hora_asignacion).getTime() > ahora) return null
  if (viaje.estado === 'sin_chofer') return 'sin_chofer'
  if (viaje.estado === 'ofrecido' && viaje.asignado_por) return 'sin_aceptar'
  if (viaje.estado === 'asignado') return 'no_salio'
  return null
}

// Tipo de viaje + hora para mostrar: "Presentarse 15:00" o "Inmediato".
export function cuando(viaje) {
  return viaje.tipo === 'programado'
    ? `${fechaCorta(viaje.hora_presentacion)} ${hora(viaje.hora_presentacion)}`
    : `Inmediato (${hora(viaje.hora_asignacion)})`
}
