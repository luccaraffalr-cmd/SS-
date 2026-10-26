import { useState } from 'react'
import { supabase } from './supabase.js'
import { textoError } from './estados.js'
import { subirArchivo } from './adjuntos.js'
import GrabarAudio from './GrabarAudio.jsx'

// Chofer: devolver un viaje que ya tiene (pedido del dueño, 26/10/2026), por ejemplo si se le rompe el auto. Cuenta qué
// pasó (escrito y/o con audio) y, si ya estaba con el pasajero, dónde está. El viaje vuelve a la cola como prioritario,
// él queda Libre y a gestión le avisa (devolver_viaje, SQL 042).
export default function DevolverViaje({ viaje, perfilId, onListo, onCancelar }) {
  const conPasajero = !!viaje.iniciado_en
  const [motivo, setMotivo] = useState('')
  const [audio, setAudio] = useState(null)
  const [donde, setDonde] = useState('')
  const [aca, setAca] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  async function devolver() {
    setError('')
    if (!motivo.trim() && !audio) return setError('Contá qué pasó: escribilo o grabá un audio.')
    setEnviando(true)
    try {
      const archivo = audio && new File([audio.blob], 'audio.webm', { type: audio.blob.type || 'audio/webm' })
      const adjunto = archivo ? await subirArchivo('observaciones', archivo, `chofer/${perfilId}/`) : null
      const { error } = await supabase.rpc('devolver_viaje', {
        p_viaje: viaje.id, p_motivo: motivo.trim() || null, p_audio: adjunto,
        p_donde: conPasajero ? donde.trim() || null : null, p_aca: conPasajero && aca,
      })
      if (error) throw error
      onListo()
    } catch (e) {
      setError('No se pudo devolver: ' + textoError(e))
    }
    setEnviando(false)
  }

  return (
    <div className="devolver-viaje">
      <p className="sin-margen"><strong>↩️ Devolver el viaje</strong></p>
      <small className="ayuda sin-margen">
        El viaje vuelve a la cola para otro chofer, vos quedás Libre y a gestión le llega un aviso.
      </small>
      <label>
        ¿Qué pasó?
        <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ej: se me rompió el auto" />
      </label>
      <GrabarAudio audio={audio} onCambiar={setAudio} />
      {conPasajero && (
        <>
          <label>
            ¿Dónde tiene que ir a buscar al pasajero el próximo chofer?
            <input value={donde} onChange={(e) => setDonde(e.target.value)} placeholder="ej: Av. Rivadavia y Medrano" />
          </label>
          <button type="button" className={'chip-chofer' + (aca ? ' elegido-aca' : '')} onClick={() => setAca(!aca)}>
            {aca ? '✅' : '📍'} Está donde estoy yo
          </button>
        </>
      )}
      {error && <p className="aviso error sin-margen">{error}</p>}
      <button type="button" className="boton peligro" disabled={enviando} onClick={devolver}>
        {enviando ? 'Devolviendo…' : 'Devolver el viaje'}
      </button>
      <button type="button" className="boton secundario sin-margen-arriba" onClick={onCancelar}>Volver</button>
    </div>
  )
}
