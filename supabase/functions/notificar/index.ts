// Manda las notificaciones push al celular del chofer (app Android y navegador). La llama la base de datos:
// - { oferta_id }: cuando le ofrecen o asignan un viaje (disparador en "ofertas"). Si la oferta es de la cola, a los demás
//   choferes que están trabajando les llega "📣 Salió un viaje para Juan" (con el cliente).
// - { aviso_id }: un aviso guardado en la tabla "avisos" (es hora de salir, cambió tu viaje, se anuló,
//   también si se lo pasaron a otro, viaje sin chofer para tomar; y a los admins, cuando nadie tomó un viaje).
//   Lo crea la base con crear_aviso() o enviar_aviso().
// Cada aviso se manda una sola vez y solo si es reciente (evita duplicados y usos indebidos).
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT')!,
  Deno.env.get('VAPID_PUBLIC')!,
  Deno.env.get('VAPID_PRIVATE')!,
)

// fuerte: suena con el sonido propio y largo (canal "avisos_viaje", app versión 2 o más): viaje ofrecido o asignado,
// "es hora de salir" y las alertas a los admins. Los demás (cambió, se anuló) van por el canal "viajes", con el sonido común.
type Aviso = { titulo: string; cuerpo: string; etiqueta: string; fuerte?: boolean }
type Viaje = {
  id: number; tipo: string; origen: string; destino: string | null; hora_presentacion: string | null; cliente_nombre?: string | null
}

function respuesta(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } })
}

const horaArgentina = (fecha: string, opciones: Intl.DateTimeFormatOptions) =>
  new Date(fecha).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', ...opciones })

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let datos: { oferta_id?: unknown; aviso_id?: unknown }
  try { datos = await req.json() } catch { return respuesta({ error: 'Datos inválidos' }, 400) }

  const hace2min = new Date(Date.now() - 2 * 60 * 1000).toISOString()

  // Avisos guardados por la base (tabla "avisos"): es hora de salir, cambió tu viaje, se anuló…
  if (datos.aviso_id !== undefined) {
    const { data: aviso } = await admin.from('avisos')
      .update({ notificado_en: new Date().toISOString() })
      .eq('id', Number(datos.aviso_id)).is('notificado_en', null).gte('creado_en', hace2min)
      .select('chofer_id, titulo, cuerpo, etiqueta')
      .maybeSingle()
    if (!aviso) return respuesta({ ok: true, enviadas: 0, motivo: 'aviso no válido o ya enviado' })
    const enviadas = await enviarATodos(admin, aviso.chofer_id,
      { titulo: aviso.titulo, cuerpo: aviso.cuerpo, etiqueta: aviso.etiqueta,
        fuerte: aviso.etiqueta.startsWith('salida-') || aviso.etiqueta.startsWith('alerta-') })
    return respuesta({ ok: true, enviadas })
  }

  // Le ofrecen o asignan un viaje.
  const { data: oferta } = await admin.from('ofertas')
    .update({ notificada_en: new Date().toISOString() })
    .eq('id', Number(datos.oferta_id)).eq('resultado', 'pendiente').is('notificada_en', null).gte('creada_en', hace2min)
    .select('chofer_id, tipo, viaje:viajes(id, tipo, origen, destino, hora_presentacion, cliente_nombre)')
    .maybeSingle()
  if (!oferta) return respuesta({ ok: true, enviadas: 0, motivo: 'oferta no válida o ya notificada' })

  const v = oferta.viaje as Viaje
  const cuando = v.tipo === 'programado' && v.hora_presentacion
    ? 'Programado ' + horaArgentina(v.hora_presentacion, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Inmediato'
  let enviadas = await enviarATodos(admin, oferta.chofer_id, {
    titulo: oferta.tipo === 'automatica' ? '🔔 Viaje para vos' : '📌 Gestión te asignó un viaje',
    // Primero dónde buscar al pasajero (22/10/2026: los choferes se confundían con el destino). El destino no va: lo ve
    // recién al aceptar (24/10/2026, para que no elijan los viajes por a dónde van).
    cuerpo: `${cuando}\nBuscar en: ${v.origen}`,
    etiqueta: `viaje-${v.id}`,
    fuerte: true,
  })
  if (oferta.tipo === 'automatica') enviadas += await avisarALosDemas(admin, oferta.chofer_id, v)
  return respuesta({ ok: true, enviadas })
})

// "📣 Salió un viaje para Juan" a los demás choferes que están trabajando (decidido el 20/10/2026): así, si Juan no lo
// ve, le pueden avisar. Con el cliente (no el recorrido) y el sonido común. Si el viaje pasa a otro chofer, el aviso
// nuevo reemplaza al anterior (misma etiqueta). (Del 21 al 24/10/2026 también les llegaba a los admins: el dueño pidió
// que le suene solo cuando nadie toma un viaje.)
// deno-lint-ignore no-explicit-any
async function avisarALosDemas(admin: any, choferId: string, v: Viaje) {
  const { data: ofrecido } = await admin.from('perfiles').select('nombre').eq('id', choferId).maybeSingle()
  const { data: demas } = await admin.from('choferes').select('id, perfil:perfiles!inner(activo, rol)')
    .neq('estado', 'fuera_de_servicio').eq('oculto', false).neq('id', choferId)
  const aviso: Aviso = {
    titulo: `📣 Salió un viaje para ${ofrecido?.nombre ?? 'un chofer'}`,
    cuerpo: v.cliente_nombre ? `Cliente: ${v.cliente_nombre}` : 'Viaje de la cola',
    etiqueta: `salio-${v.id}`,
  }
  let enviadas = 0
  // deno-lint-ignore no-explicit-any
  for (const c of (demas ?? []).filter((c: any) => c.perfil?.activo && c.perfil?.rol === 'chofer')) {
    enviadas += await enviarATodos(admin, c.id, aviso)
  }
  return enviadas
}

// Manda el aviso a todos los celulares del chofer: app Android (Firebase) y navegador (web push).
// deno-lint-ignore no-explicit-any
async function enviarATodos(admin: any, choferId: string, aviso: Aviso) {
  let enviadas = 0
  try {
    enviadas += await enviarALaApp(admin, choferId, aviso)
  } catch (e) {
    console.error('Falló el envío a la app', (e as Error).message) // igual se manda al navegador
  }

  const { data: suscripciones } = await admin.from('push_suscripciones')
    .select('id, endpoint, p256dh, auth').eq('perfil_id', choferId)
  for (const s of suscripciones ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(aviso),
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
  return enviadas
}

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

// Permiso de Google para mandar avisos (se firma con la clave de la cuenta de servicio). Dura una hora: se reusa
// (con "Salió un viaje" se manda a varios choferes seguidos).
let permisoGuardado: { token: string; vence: number } | null = null
async function permisoDeGoogle(cuenta: Cuenta) {
  if (permisoGuardado && permisoGuardado.vence > Date.now() + 60_000) return permisoGuardado.token
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
  permisoGuardado = { token: datos.access_token, vence: Date.now() + 3_500_000 }
  return datos.access_token as string
}

// deno-lint-ignore no-explicit-any
async function enviarALaApp(admin: any, choferId: string, aviso: Aviso) {
  const secreto = Deno.env.get('FIREBASE_CUENTA')
  if (!secreto) return 0
  const { data: tokens } = await admin.from('tokens_app').select('token, version').eq('perfil_id', choferId)
  if (!tokens?.length) return 0

  const cuenta = JSON.parse(secreto) as Cuenta
  const permiso = await permisoDeGoogle(cuenta)
  let enviadas = 0
  for (const { token, version } of tokens) {
    // El sonido propio está solo en la app versión 2 o más (la 1 no tiene el canal "avisos_viaje").
    const conSonidoPropio = !!aviso.fuerte && (version ?? 1) >= 2
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
              channel_id: conSonidoPropio ? 'avisos_viaje' : 'viajes', // los canales los crea la app
              tag: aviso.etiqueta,
              sound: conSonidoPropio ? 'aviso_viaje' : 'default', // (solo cuenta en Android 7; desde el 8 manda el canal)
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
