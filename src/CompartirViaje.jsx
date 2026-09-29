import { useState } from 'react'
import { supabase } from './supabase.js'

// Gestión: genera el link de seguimiento de un viaje para mandárselo al pasajero.
export default function CompartirViaje({ viaje }) {
  const [codigo, setCodigo] = useState(viaje.codigo_seguimiento)
  const [error, setError] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [generando, setGenerando] = useState(false)

  const link = codigo ? `${window.location.origin}/seguir/${codigo}` : ''
  const mensaje = `Tu remis está en camino. Seguilo acá: ${link}`

  async function generar() {
    setError('')
    setGenerando(true)
    const { data, error } = await supabase.rpc('compartir_viaje', { viaje: viaje.id })
    setGenerando(false)
    if (error) setError('No se pudo generar el link: ' + error.message)
    else setCodigo(data)
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      setError('No se pudo copiar. Mantené apretado el link para copiarlo a mano.')
    }
  }

  return (
    <div className="tarjeta separada">
      <h2>📍 Seguimiento para el pasajero</h2>
      {!codigo ? (
        <>
          <p className="ayuda sin-margen">
            Un link con el mapa del auto en vivo, la foto, el modelo y la patente. Se apaga solo cuando el viaje se finaliza o se anula.
          </p>
          <button type="button" className="boton" disabled={generando} onClick={generar}>
            {generando ? 'Generando…' : 'Generar link'}
          </button>
        </>
      ) : (
        <>
          <a className="link-seguimiento" href={link} target="_blank" rel="noreferrer">{link}</a>
          {navigator.share && (
            <button type="button" className="boton" onClick={() => navigator.share({ text: mensaje }).catch(() => {})}>
              📤 Compartir
            </button>
          )}
          <div className="dos-columnas">
            <a className="boton verde" href={'https://wa.me/?text=' + encodeURIComponent(mensaje)} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
            <button type="button" className="boton secundario" onClick={copiar}>{copiado ? 'Copiado ✅' : 'Copiar'}</button>
          </div>
        </>
      )}
      {error && <p className="aviso error">{error}</p>}
    </div>
  )
}
