import { useEffect, useState } from 'react'

/* global __VERSION_APP__ */
const CADA_CUANTO_REVISA = 60 * 1000 // 1 minuto

// Cartel "hay una versión nueva" cuando se publicó un cambio y esta pantalla quedó vieja.
export default function AvisoVersion() {
  const [hayNueva, setHayNueva] = useState(false)

  useEffect(() => {
    if (import.meta.env.DEV) return // en la computadora de desarrollo no hace falta

    async function revisar() {
      try {
        const r = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
        const { version } = await r.json()
        if (version && version !== __VERSION_APP__) setHayNueva(true)
      } catch { /* sin internet: se revisa la próxima vez */ }
    }
    const intervalo = setInterval(revisar, CADA_CUANTO_REVISA)
    const alVolver = () => { if (document.visibilityState === 'visible') revisar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(intervalo); document.removeEventListener('visibilitychange', alVolver) }
  }, [])

  if (!hayNueva) return null
  return (
    <button className="aviso-version" onClick={() => window.location.reload()}>
      🔄 Hay una versión nueva de la app. <u>Tocá acá para actualizar.</u>
    </button>
  )
}
