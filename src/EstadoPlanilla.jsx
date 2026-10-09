import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// En el viaje (gestión): si ya se anotó en la planilla de la remisería, si se está pasando o si falló.
export default function EstadoPlanilla({ viajeId }) {
  const [envio, setEnvio] = useState(null)
  const [error, setError] = useState('')

  const cargar = useCallback(() => {
    supabase.from('planilla_envios').select('pendiente, error, fila, intentos').eq('viaje_id', viajeId).maybeSingle()
      .then(({ data }) => setEnvio(data))
  }, [viajeId])

  // Mientras se está pasando, revisa cada 5 segundos.
  const pasando = !!envio?.pendiente && !envio.error
  useEffect(() => {
    cargar()
    if (!pasando) return
    const t = setInterval(cargar, 5000)
    return () => clearInterval(t)
  }, [cargar, pasando])

  async function reintentar() {
    setError('')
    const { error } = await supabase.rpc('reintentar_envio_planilla', { viaje: viajeId })
    if (error) setError('No se pudo: ' + error.message)
    cargar()
  }

  if (!envio) return null
  if (envio.error) {
    return (
      <>
        <p className="aviso error sin-margen">
          ⚠️ {envio.pendiente ? 'No se pudo pasar a la planilla' : 'No se pasó a la planilla'}: {envio.error}
          {envio.pendiente && envio.intentos < 30 && ' Se vuelve a intentar solo cada 5 minutos.'}
        </p>
        {envio.pendiente && <button type="button" className="boton secundario" onClick={reintentar}>Volver a intentar ahora</button>}
        {error && <p className="aviso error">{error}</p>}
      </>
    )
  }
  if (envio.pendiente) return <p className="ayuda sin-margen">📄 Pasando a la planilla…</p>
  return <p className="ayuda sin-margen">📄 Anotado en la planilla{envio.fila ? ` (fila ${envio.fila})` : ''}.</p>
}
