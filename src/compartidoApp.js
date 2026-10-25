import { registerPlugin } from '@capacitor/core'
import { esAppAndroid } from './ubicacionApp.js'

// "Compartir desde WhatsApp" (22/10/2026). Parte nativa (desde la versión 3 de la app):
// android/app/src/main/java/ar/remiseria/app/CompartidoPlugin.java
const Compartido = registerPlugin('Compartido')

// Lo que compartieron hacia la app (WhatsApp → Compartir → Senda Segura) o null. Se puede leer una sola vez.
// { texto?, archivo?: { base64, nombre, tipo }, error? }
export async function leerCompartido() {
  if (!esAppAndroid) return null
  try {
    return (await Compartido.leer()).compartido ?? null
  } catch {
    return null // la app versión 1 y 2 no tienen esta parte
  }
}

// Avisa cuando comparten algo con la app ya abierta. Devuelve la función para dejar de escuchar.
export function alCompartir(funcion) {
  if (!esAppAndroid) return () => {}
  const escucha = Promise.resolve().then(() => Compartido.addListener('compartido', funcion)).catch(() => null)
  return () => { escucha.then((e) => e?.remove()) }
}

// El archivo compartido como un archivo normal, para subirlo igual que desde "Subir foto, audio o archivo".
export function archivoCompartido({ base64, nombre, tipo }) {
  const binario = atob(base64)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return new File([bytes], nombre || 'archivo', { type: tipo || '' })
}
