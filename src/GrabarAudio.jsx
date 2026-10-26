import { useEffect, useRef, useState } from 'react'

const MAXIMO_SEGUNDOS = 120

const duracion = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// Grabar un audio con el micrófono (26/10/2026). audio: { blob, segundos, url } o null; onCambiar(audio o null).
// En la app Android hace falta la versión 1.3 o más (permiso del micrófono); si no se puede, avisa que lo escriba.
export default function GrabarAudio({ audio, onCambiar }) {
  const [grabando, setGrabando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [error, setError] = useState('')
  const grabador = useRef(null)
  const reloj = useRef(null)

  async function empezar() {
    setError('')
    try {
      const flujo = await navigator.mediaDevices.getUserMedia({ audio: true })
      const g = new MediaRecorder(flujo)
      const partes = []
      const inicio = Date.now()
      g.ondataavailable = (e) => { if (e.data.size) partes.push(e.data) }
      g.onstop = () => {
        flujo.getTracks().forEach((t) => t.stop())
        clearInterval(reloj.current)
        setGrabando(false)
        const blob = new Blob(partes, { type: (g.mimeType || 'audio/webm').split(';')[0] })
        onCambiar({ blob, segundos: Math.round((Date.now() - inicio) / 1000), url: URL.createObjectURL(blob) })
      }
      g.start()
      grabador.current = g
      setSegundos(0)
      setGrabando(true)
      reloj.current = setInterval(() => {
        const s = Math.floor((Date.now() - inicio) / 1000)
        setSegundos(s)
        if (s >= MAXIMO_SEGUNDOS) g.stop()
      }, 250)
    } catch {
      setError('No se pudo usar el micrófono. Aceptá el permiso del micrófono (o, si tenés la app vieja, escribilo).')
    }
  }

  // Si se cierra la pantalla grabando, se corta.
  useEffect(() => () => {
    clearInterval(reloj.current)
    if (grabador.current?.state === 'recording') grabador.current.stop()
  }, [])

  if (audio) {
    return (
      <div className="grabar-audio">
        <audio controls src={audio.url} />
        <button type="button" className="boton-chico" onClick={() => onCambiar(null)}>Borrar audio</button>
      </div>
    )
  }
  return (
    <div className="grabar-audio">
      {grabando ? (
        <button type="button" className="boton peligro" onClick={() => grabador.current?.stop()}>
          ⏹️ Parar ({duracion(segundos)})
        </button>
      ) : (
        <button type="button" className="boton secundario sin-margen-arriba" onClick={empezar}>🎤 Grabar audio</button>
      )}
      {error && <small className="texto-alerta">{error}</small>}
    </div>
  )
}
