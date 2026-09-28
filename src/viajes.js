export const NOMBRE_ESTADO_VIAJE = {
  sin_chofer: 'Sin chofer',
  ofrecido: 'Esperando que acepte',
  asignado: 'Asignado',
  pago_pendiente: 'Pago pendiente',
  finalizado: 'Finalizado',
  fallido: 'Fallido',
  anulado: 'Anulado',
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

// "2:31" que le quedan para aceptar una oferta automática.
export function tiempoRestante(vence, ahora = Date.now()) {
  const seg = Math.max(0, Math.ceil((new Date(vence).getTime() - ahora) / 1000))
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`
}

// Tipo de viaje + hora para mostrar: "Presentarse 15:00" o "Inmediato".
export function cuando(viaje) {
  return viaje.tipo === 'programado'
    ? `${fechaCorta(viaje.hora_presentacion)} ${hora(viaje.hora_presentacion)}`
    : `Inmediato (${hora(viaje.hora_asignacion)})`
}
