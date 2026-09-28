import { useEffect, useState } from 'react'
import { activarNotificaciones, notificacionesActivas, notificacionesSoportadas } from './notificaciones.js'

// Guarda el aviso de "instalar la app" que da Chrome, para mostrar nuestro propio botón.
let avisoInstalar = null
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); avisoInstalar = e })

const instalada = () => window.matchMedia('(display-mode: standalone)').matches

// Recuadro para que el chofer active las notificaciones (y, si puede, instale la app).
export default function ActivarNotificaciones() {
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
          <p className="sin-margen">
            Así te suena el celular cuando te ofrecen un viaje, aunque tengas la app cerrada o la pantalla bloqueada.
          </p>
          {notificacionesSoportadas()
            ? <button className="boton grande verde" onClick={activar}>Activar notificaciones</button>
            : <p className="aviso error sin-margen">Este navegador no permite notificaciones. Abrí la app con Chrome.</p>}
          {error && <p className="aviso error sin-margen">{error}</p>}
        </section>
      )}
      {puedeInstalar && (
        <button className="boton secundario" onClick={instalar}>📲 Instalar la app en el celular</button>
      )}
      {activas && <p className="ayuda centrada">🔔 Notificaciones activadas en este celular</p>}
    </>
  )
}
