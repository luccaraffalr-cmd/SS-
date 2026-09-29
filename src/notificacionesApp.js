import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from './supabase.js'

// Avisos de viajes en la app Android (Firebase). En el navegador se usan los de notificaciones.js.

let escuchando = false

// Cuando Firebase le da un "token" al celular, se guarda a nombre de quien está usando la app.
function escucharRegistro() {
  if (escuchando) return
  escuchando = true
  PushNotifications.addListener('registration', ({ value }) => {
    localStorage.setItem('token_app', value)
    // (El pedido a Supabase recién sale al esperar la respuesta: por eso el .then.)
    supabase.rpc('guardar_token_app', { p_token: value })
      .then(({ error }) => { if (error) console.error('No se pudo guardar el token de avisos', error.message) })
  })
  PushNotifications.addListener('registrationError', (e) => console.error('No se pudo registrar para avisos', e))
}

// Canal "Viajes": con sonido y vibración, aparece arriba de todo aunque la pantalla esté bloqueada.
async function crearCanal() {
  await PushNotifications.createChannel({
    id: 'viajes',
    name: 'Viajes',
    description: 'Cuando te ofrecen o te asignan un viaje',
    importance: 5,
    visibility: 1,
    vibration: true,
    lights: true,
  })
}

export async function permisoNotificacionesApp() {
  return (await PushNotifications.checkPermissions()).receive === 'granted'
}

// Si ya hay permiso, registra el celular (hay que hacerlo cada vez que se abre la app).
export async function prepararNotificacionesApp() {
  if (!(await permisoNotificacionesApp())) return false
  escucharRegistro()
  await crearCanal()
  await PushNotifications.register()
  return true
}

// Pide el permiso (lo muestra Android) y, si lo dan, registra el celular.
export async function pedirNotificacionesApp() {
  const { receive } = await PushNotifications.requestPermissions()
  if (receive !== 'granted') return false
  return prepararNotificacionesApp()
}

// Al cerrar sesión: este celular deja de recibir avisos de ese usuario.
export async function olvidarNotificacionesApp() {
  const token = localStorage.getItem('token_app')
  if (token) await supabase.rpc('borrar_token_app', { p_token: token })
  localStorage.removeItem('token_app')
}
