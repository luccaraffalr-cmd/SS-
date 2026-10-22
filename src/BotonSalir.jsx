import { supabase } from './supabase.js'
import { esAppAndroid } from './ubicacionApp.js'
import { olvidarNotificacionesApp } from './notificacionesApp.js'

// Cerrar sesión: en la app Android, este celular también deja de recibir los avisos de ese usuario.
async function salir() {
  if (esAppAndroid) await olvidarNotificacionesApp().catch(() => {})
  supabase.auth.signOut()
}

export default function BotonSalir() {
  return (
    <button className="boton secundario" onClick={salir}>
      Cerrar sesión
    </button>
  )
}
