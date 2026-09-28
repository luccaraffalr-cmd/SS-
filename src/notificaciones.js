import { supabase } from './supabase.js'

const CLAVE_PUBLICA = import.meta.env.VITE_VAPID_PUBLIC

export function notificacionesSoportadas() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// Registra el service worker (el que recibe las notificaciones con la app cerrada).
export function registrarServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sin soporte: no pasa nada */ })
  }
}

// ¿Este celular ya tiene las notificaciones activadas?
export async function notificacionesActivas() {
  if (!notificacionesSoportadas() || Notification.permission !== 'granted') return false
  const reg = await navigator.serviceWorker.ready
  return !!(await reg.pushManager.getSubscription())
}

// Pide permiso y guarda la suscripción de este celular. Devuelve un texto de error o nada.
export async function activarNotificaciones() {
  if (!notificacionesSoportadas()) return 'Este celular o navegador no permite notificaciones. Usá Chrome.'
  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') {
    return 'No diste permiso. Andá a los ajustes de Chrome → Configuración del sitio → Notificaciones, y permitilas para esta app.'
  }
  try {
    const reg = await navigator.serviceWorker.ready
    const sus = (await reg.pushManager.getSubscription())
      ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64aBytes(CLAVE_PUBLICA) })
    const { endpoint, keys } = sus.toJSON()
    const { error } = await supabase.rpc('guardar_suscripcion', {
      p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
    })
    if (error) return 'No se pudo guardar: ' + error.message
  } catch (e) {
    return 'No se pudieron activar: ' + e.message
  }
}

function base64aBytes(texto) {
  const relleno = '='.repeat((4 - (texto.length % 4)) % 4)
  const b64 = (texto + relleno).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

// Pitido corto (cuando llega una oferta con la app abierta).
export function pitido() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[0, 0.35, 0.7].forEach((t) => {
      const osc = ctx.createOscillator()
      const vol = ctx.createGain()
      osc.frequency.value = 880
      vol.gain.setValueAtTime(0.4, ctx.currentTime + t)
      vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3)
      osc.connect(vol).connect(ctx.destination)
      osc.start(ctx.currentTime + t)
      osc.stop(ctx.currentTime + t + 0.3)
    })
    navigator.vibrate?.([300, 150, 300])
  } catch { /* sin sonido disponible */ }
}
