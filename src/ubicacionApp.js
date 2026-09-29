import { Capacitor, registerPlugin } from '@capacitor/core'
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from './supabase.js'

// true solo dentro de la app Android (en el navegador no hay ubicación en segundo plano).
export const esAppAndroid = Capacitor.getPlatform() === 'android'

// Parte nativa: android/app/src/main/java/ar/remiseria/app/UbicacionPlugin.java
export const Ubicacion = registerPlugin('Ubicacion')

// Cada chofer tiene una clave para su celular: se crea la primera vez y se guarda en el celular.
async function claveDelCelular(choferId) {
  const guardada = localStorage.getItem('clave_ubicacion')
  const [dueno, clave] = (guardada ?? '').split(':')
  if (dueno === choferId && clave) return clave
  const { data, error } = await supabase.rpc('crear_clave_ubicacion')
  if (error) throw error
  localStorage.setItem('clave_ubicacion', `${choferId}:${data}`)
  return data
}

export async function empezarACompartir(choferId) {
  const clave = await claveDelCelular(choferId)
  return Ubicacion.iniciar({ clave, url: SUPABASE_URL, apikey: SUPABASE_ANON_KEY })
}

export const dejarDeCompartir = () => Ubicacion.detener()
