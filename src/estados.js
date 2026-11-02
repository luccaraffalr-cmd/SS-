// Los 4 estados del chofer. Solo cambian cuando alguien toca un botón
// (o al asignar / terminar un viaje), nunca solos por tiempo.
export const NOMBRE_ESTADO = {
  fuera_de_servicio: 'Fuera de servicio',
  libre: 'Libre',
  en_cola: 'En cola',
  en_viaje: 'En viaje',
}

// Un tiempo con una sola unidad, la más grande (pedido del 2/11/2026): "2 días", "3 horas", "25 minutos" y, si falta
// menos de un minuto, "40 segundos". Redondea para abajo (1 hora y 50 minutos → "1 hora"). ms: milisegundos.
const UNIDADES = [[86400, 'día', 'días'], [3600, 'hora', 'horas'], [60, 'minuto', 'minutos'], [1, 'segundo', 'segundos']]
export function cuantoTiempo(ms) {
  const segundos = Math.max(0, Math.floor(ms / 1000))
  for (const [cada, uno, varios] of UNIDADES) {
    const n = Math.floor(segundos / cada)
    if (n >= 1) return `${n} ${n === 1 ? uno : varios}`
  }
  return '0 segundos'
}

// "recién", "hace 3 minutos", "hace 2 horas"…
export function haceCuanto(fecha, ahora = Date.now()) {
  if (!fecha) return 'nunca'
  const ms = ahora - new Date(fecha).getTime()
  return ms < 60000 ? 'recién' : `hace ${cuantoTiempo(ms)}`
}

// Mensaje de error legible a partir de un error de Supabase.
export function textoError(error) {
  return error?.message ?? 'Algo salió mal.'
}
