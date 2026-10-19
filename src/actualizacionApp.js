import { registerPlugin } from '@capacitor/core'
import { esAppAndroid } from './ubicacionApp.js'

// Parte nativa (desde la versión 2 de la app): android/app/src/main/java/ar/remiseria/app/ActualizacionPlugin.java
export const Actualizacion = registerPlugin('Actualizacion')

let version = null // se pregunta una sola vez

// Versión de la app Android: { version: '1.1', codigo: 2 }. En el navegador, null. La versión 1 no la sabe decir:
// para ella devuelve { version: '1.0', codigo: 1 }.
export function versionDeLaApp() {
  if (!esAppAndroid) return Promise.resolve(null)
  version ??= Actualizacion.info().catch(() => ({ version: '1.0', codigo: 1 }))
  return version
}
