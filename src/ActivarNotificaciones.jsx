import { useEffect, useState } from 'react'
import { activarNotificaciones, notificacionesActivas, notificacionesSoportadas } from './notificaciones.js'
import { pedirNotificacionesApp, prepararNotificacionesApp } from './notificacionesApp.js'
import { Ubicacion, esAppAndroid } from './ubicacionApp.js'

// Guarda el aviso de "instalar la app" que da Chrome, para mostrar nuestro propio botón.
let avisoInstalar = null
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); avisoInstalar = e })

const instalada = () => window.matchMedia('(display-mode: standalone)').matches

const EXPLICACION_CHOFER = 'Así te suena el celular cuando te ofrecen un viaje, aunque tengas la app cerrada o la pantalla bloqueada.'

// Recuadro para que el chofer (o el admin) active las notificaciones: en la app Android, las de Android (Firebase);
// en el navegador, las web (y, si puede, que instale la página como app).
// discreto: con las notificaciones ya activadas no muestra nada (en gestión, arriba de todo).
export default function ActivarNotificaciones({ explicacion = EXPLICACION_CHOFER, discreto = false }) {
  return esAppAndroid
    ? <ActivarNotificacionesApp explicacion={explicacion} discreto={discreto} />
    : <ActivarNotificacionesWeb explicacion={explicacion} discreto={discreto} />
}

function ActivarNotificacionesApp({ explicacion, discreto }) {
  const [activas, setActivas] = useState(null) // null = revisando
  const [negadas, setNegadas] = useState(false)

  useEffect(() => {
    const revisar = () => prepararNotificacionesApp().then(setActivas).catch(() => setActivas(false))
    revisar()
    // Al volver de los ajustes del celular.
    const alVolver = () => { if (document.visibilityState === 'visible') revisar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [])

  async function activar() {
    const ok = await pedirNotificacionesApp().catch(() => false)
    setActivas(ok)
    setNegadas(!ok)
  }

  if (activas === null) return null
  if (activas) return discreto ? null : <p className="ayuda centrada">🔔 Notificaciones activadas en este celular</p>
  return (
    <section className="tarjeta separada aviso-notificaciones">
      <h2>🔔 Activá las notificaciones</h2>
      <p className="sin-margen">{explicacion}</p>
      <button className="boton grande verde" onClick={activar}>Activar notificaciones</button>
      {negadas && (
        <>
          <p className="aviso error sin-margen">
            El celular no dejó activarlas. Tocá el botón de abajo → <strong>Notificaciones</strong> → activalas.
          </p>
          <button className="boton secundario" onClick={() => Ubicacion.abrirAjustes()}>Abrir los ajustes de la app</button>
        </>
      )}
    </section>
  )
}

function ActivarNotificacionesWeb({ explicacion, discreto }) {
  const [activas, setActivas] = useState(null) // null = revisando
  const [error, setError] = useState('')
  const [puedeInstalar, setPuedeInstalar] = useState(!!avisoInstalar && !instalada())

  useEffect(() => {
    notificacionesActivas().then(setActivas)
    const alAvisar = () => setPuedeInstalar(!instalada())
    window.addEventListener('beforeinstallprompt', alAvisar)
    return () => window.removeEventListener('beforeinstallprompt', alAvisar)
  }, [])

  async function activar() {
    setError('')
    const err = await activarNotificaciones()
    if (err) setError(err)
    setActivas(await notificacionesActivas())
  }

  async function instalar() {
    if (!avisoInstalar) return
    avisoInstalar.prompt()
    await avisoInstalar.userChoice
    avisoInstalar = null
    setPuedeInstalar(false)
  }

  if (activas === null) return null

  return (
    <>
      {!activas && (
        <section className="tarjeta separada aviso-notificaciones">
          <h2>🔔 Activá las notificaciones</h2>
          <p className="sin-margen">{explicacion}</p>
          {notificacionesSoportadas()
            ? <button className="boton grande verde" onClick={activar}>Activar notificaciones</button>
            : <p className="aviso error sin-margen">Este navegador no permite notificaciones. Abrí la app con Chrome.</p>}
          {error && <p className="aviso error sin-margen">{error}</p>}
        </section>
      )}
      {puedeInstalar && !discreto && (
        <button className="boton secundario" onClick={instalar}>📲 Instalar la app en el celular</button>
      )}
      {activas && !discreto && <p className="ayuda centrada">🔔 Notificaciones activadas en este celular</p>}
    </>
  )
}
