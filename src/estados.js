export const NOMBRE_ESTADO = {
  desconectado: 'Desconectado',
  conectado: 'Conectado',
  yendo: 'Yendo',
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
