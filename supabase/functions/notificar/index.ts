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
    titulo: automatica ? '🔔 Viaje para vos — tenés 3 minutos' : '📌 Gestión te asignó un viaje',
    cuerpo: `${cuando}\n${v.origen}${v.destino ? ' → ' + v.destino : ''}`,
    etiqueta: `viaje-${v.id}`,
  })

  const { data: suscripciones } = await admin.from('push_suscripciones')
    .select('id, endpoint, p256dh, auth').eq('perfil_id', oferta.chofer_id)

  let enviadas = 0
  for (const s of suscripciones ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        mensaje,
        { TTL: automatica ? 180 : 3600, urgency: 'high' },
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
