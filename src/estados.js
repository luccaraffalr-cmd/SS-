// Los 4 estados del chofer. Solo cambian cuando alguien toca un botón
// (o al asignar / terminar un viaje), nunca solos por tiempo.
export const NOMBRE_ESTADO = {
  fuera_de_servicio: 'Fuera de servicio',
  libre: 'Libre',
  en_cola: 'En cola',
  en_viaje: 'En viaje',
}

// "hace 3 min", "hace 2 h"…
export function haceCuanto(fecha, ahora = Date.now()) {
  if (!fecha) return 'nunca'
  const minutos = Math.floor((ahora - new Date(fecha).getTime()) / 60000)
  if (minutos < 1) return 'recién'
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `hace ${horas} h`
  return `hace ${Math.floor(horas / 24)} d`
}

// Mensaje de error legible a partir de un error de Supabase.
export function textoError(error) {
  return error?.message ?? 'Algo salió mal.'
}
