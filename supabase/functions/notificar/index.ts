// Manda la notificación push al celular del chofer cuando le ofrecen o asignan un viaje.
// La llama la base de datos (disparador en "ofertas") apenas se crea una oferta.
// Solo notifica ofertas pendientes, recién creadas y que todavía no se notificaron.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT')!,
  Deno.env.get('VAPID_PUBLIC')!,
  Deno.env.get('VAPID_PRIVATE')!,
)

function respuesta(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let ofertaId: number
  try { ofertaId = Number((await req.json()).oferta_id) } catch { return respuesta({ error: 'Datos inválidos' }, 400) }

  // Marca la oferta como notificada, solo si es nueva (evita duplicados y usos indebidos).
  const hace2min = new Date(Date.now() - 2 * 60 * 1000).toISOString()
  const { data: oferta } = await admin.from('ofertas')
    .update({ notificada_en: new Date().toISOString() })
    .eq('id', ofertaId).eq('resultado', 'pendiente').is('notificada_en', null).gte('creada_en', hace2min)
    .select('chofer_id, tipo, viaje:viajes(id, tipo, origen, destino, hora_presentacion)')
    .maybeSingle()
  if (!oferta) return respuesta({ ok: true, enviadas: 0, motivo: 'oferta no válida o ya notificada' })

  const v = oferta.viaje as { id: number; tipo: string; origen: string; destino: string | null; hora_presentacion: string | null }
  const automatica = oferta.tipo === 'automatica'
  let cuando = 'Inmediato'
  if (v.tipo === 'programado' && v.hora_presentacion) {
    cuando = 'Programado ' + new Date(v.hora_presentacion).toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short', hour: '2-digit', minute: '2-digit',
    })
  }
  const mensaje = JSON.stringify({
    titulo: automatica ? '🔔 Viaje para vos' : '📌 Gestión te asignó un viaje',
    cuerpo: `${cuando}\n${v.origen}${v.destino ? ' → ' + v.destino : ''}`,
    etiqueta: `viaje-${v.id}`,
  })

  const { data: suscripciones } = await admin.from('push_suscripciones')
    .select('id, endpoint, p256dh, auth').eq('perfil_id', oferta.chofer_id)

  // App Android (Firebase).
  let enviadas = 0
  try {
    enviadas += await enviarALaApp(admin, oferta.chofer_id, JSON.parse(mensaje), v.id)
  } catch (e) {
    console.error('Falló el envío a la app', (e as Error).message) // igual se manda al navegador
  }

  for (const s of suscripciones ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        mensaje,
        { TTL: 3600, urgency: 'high' },
      )
      enviadas++
    } catch (e) {
      // El celular ya no acepta notificaciones (desinstaló, borró datos…): se borra la suscripción.
      const codigo = (e as { statusCode?: number }).statusCode
      if (codigo === 404 || codigo === 410) await admin.from('push_suscripciones').delete().eq('id', s.id)
      else console.error('No se pudo enviar', codigo, (e as Error).message)
    }
  }
  return respuesta({ ok: true, enviadas })
})

// ---------------------------------------------------------------------------
// App Android: avisos por Firebase Cloud Messaging.
// La clave de Firebase (cuenta de servicio, un JSON) está en el secret FIREBASE_CUENTA.
// ---------------------------------------------------------------------------

type Cuenta = { project_id: string; client_email: string; private_key: string }

function base64url(datos: Uint8Array | string) {
  const bytes = typeof datos === 'string' ? new TextEncoder().encode(datos) : datos
  let binario = ''
  for (const b of bytes) binario += String.fromCharCode(b)
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Permiso de Google para mandar avisos (se firma con la clave de la cuenta de servicio).
async function permisoDeGoogle(cuenta: Cuenta) {
  const ahora = Math.floor(Date.now() / 1000)
  const sinFirmar = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + base64url(JSON.stringify({
    iss: cuenta.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: ahora,
    exp: ahora + 3600,
  }))
  const pem = cuenta.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const clave = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, new TextEncoder().encode(sinFirmar)))
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: sinFirmar + '.' + base64url(firma),
    }),
  })
  const datos = await r.json()
  if (!datos.access_token) throw new Error('Google no dio permiso: ' + JSON.stringify(datos))
  return datos.access_token as string
}

// deno-lint-ignore no-explicit-any
async function enviarALaApp(admin: any, choferId: string, aviso: { titulo: string; cuerpo: string }, viajeId: number) {
  const secreto = Deno.env.get('FIREBASE_CUENTA')
  if (!secreto) return 0
  const { data: tokens } = await admin.from('tokens_app').select('token').eq('perfil_id', choferId)
  if (!tokens?.length) return 0

  const cuenta = JSON.parse(secreto) as Cuenta
  const permiso = await permisoDeGoogle(cuenta)
  let enviadas = 0
  for (const { token } of tokens) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${cuenta.project_id}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + permiso },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: aviso.titulo, body: aviso.cuerpo },
          android: {
            priority: 'HIGH',
            ttl: '3600s',
            notification: {
              channel_id: 'viajes', // canal con sonido fuerte (lo crea la app)
              tag: `viaje-${viajeId}`,
              sound: 'default',
              default_vibrate_timings: true,
              notification_priority: 'PRIORITY_MAX',
              visibility: 'PUBLIC',
            },
          },
        },
      }),
    })
    if (r.ok) { enviadas++; continue }
    const error = await r.text()
    // El celular ya no tiene la app (o la reinstaló): se borra ese token.
    if (r.status === 404 || error.includes('UNREGISTERED')) {
      await admin.from('tokens_app').delete().eq('token', token)
    } else {
      console.error('No se pudo enviar a la app', r.status, error)
    }
  }
  return enviadas
}
