// Service worker de la app: recibe las notificaciones push aunque la app esté cerrada.
// (No guarda copias de la app: siempre se carga la última versión desde internet.)

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()))

self.addEventListener('push', (evento) => {
  let datos = {}
  try { datos = evento.data ? evento.data.json() : {} } catch { datos = { cuerpo: evento.data?.text() } }

  evento.waitUntil(self.registration.showNotification(datos.titulo || 'Remisería', {
    body: datos.cuerpo || '',
    tag: datos.etiqueta || 'remiseria',
    renotify: true,             // vuelve a sonar aunque haya una notificación anterior
    requireInteraction: true,   // queda en pantalla hasta que la toque
    vibrate: [300, 150, 300, 150, 600],
    icon: '/icono-192.png',
    badge: '/icono-192.png',
    data: { url: '/' },
  }))
})

// Al tocar la notificación, abre la app (o la trae al frente si ya estaba abierta).
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close()
  evento.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const v of ventanas) {
      if ('focus' in v) return v.focus()
    }
    return self.clients.openWindow('/')
  })())
})
