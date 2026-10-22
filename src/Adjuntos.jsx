import { useEffect, useRef, useState } from 'react'
import { adjuntoDeLink, esUbicacion, leerLink, subirArchivo, textoAdjunto, urlDeArchivo } from './adjuntos.js'
import { useAtras } from './atras.js'

// Clip simple, del color del texto (para "Agregar").
const Clip = () => (
  <svg className="icono-clip" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 7l-6.5 6.5a1.5 1.5 0 0 0 3 3l6.5 -6.5a3 3 0 0 0 -6 -6l-6.5 6.5a4.5 4.5 0 0 0 9 9l6.5 -6.5" />
  </svg>
)

// Los adjuntos de una parte del viaje (campo: 'origen' | 'destino' | 'observaciones'), como botoncitos chicos para no
// recargar la pantalla. Los usa el chofer y también gestión.
export default function VerAdjuntos({ campo, adjuntos }) {
  const deEsteCampo = (adjuntos ?? []).filter((a) => a.campo === campo)
  if (deEsteCampo.length === 0) return null
  return (
    <div className="adjuntos">
      {deEsteCampo.map((a) => <BotonAdjunto key={a.id} adjunto={a} />)}
    </div>
  )
}

// Gestión: los adjuntos de una parte del viaje, con ✕ para sacarlos, y "Agregar" (pegar un link o una ubicación,
// o subir una foto, un audio o un archivo). onCambiar recibe una función que cambia la lista.
export function EditarAdjuntos({ campo, adjuntos, onCambiar }) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [nombre, setNombre] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')
  const deEsteCampo = adjuntos.filter((a) => a.campo === campo)
  const link = leerLink(texto)

  function cerrar() {
    setAbierto(false)
    setTexto('')
    setNombre('')
    setError('')
  }

  function agregarLink() {
    const nuevo = adjuntoDeLink(campo, texto, nombre)
    if (!nuevo) return setError('Pegá un link (empieza con https://) o una ubicación de Google Maps.')
    onCambiar((lista) => [...lista, nuevo])
    cerrar()
  }

  async function alElegirArchivos(e) {
    const archivos = [...e.target.files]
    e.target.value = ''
    if (archivos.length === 0) return
    setError('')
    setSubiendo(true)
    try {
      for (const archivo of archivos) {
        const nuevo = await subirArchivo(campo, archivo)
        onCambiar((lista) => [...lista, nuevo])
      }
      cerrar()
    } catch (err) {
      setError('No se pudo subir: ' + err.message)
    }
    setSubiendo(false)
  }

  return (
    <>
      <div className="adjuntos">
        {deEsteCampo.map((a) => (
          <span key={a.id} className="adjunto-con-sacar">
            <BotonAdjunto adjunto={a} />
            <button type="button" className="sacar-adjunto" aria-label="Sacar"
              onClick={() => onCambiar((lista) => lista.filter((x) => x.id !== a.id))}>✕</button>
          </span>
        ))}
        {!abierto && (
          <button type="button" className="agregar-adjunto" onClick={() => setAbierto(true)}><Clip /> Agregar</button>
        )}
      </div>
      {abierto && (
        <div className="panel-adjunto">
          <input value={texto} onChange={(e) => { setTexto(e.target.value); setError('') }}
            placeholder="Pegá el link o la ubicación"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarLink() } }} />
          {link && !esUbicacion(link) && (
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre (opcional), ej: Autorización"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarLink() } }} />
          )}
          {texto.trim() && (
            <button type="button" className="boton" onClick={agregarLink}>
              {link && esUbicacion(link) ? '📍 Agregar ubicación' : '🔗 Agregar link'}
            </button>
          )}
          <label className={'boton secundario' + (subiendo ? ' deshabilitado' : '')}>
            {subiendo ? 'Subiendo…' : '📁 Subir foto, audio o archivo'}
            <input type="file" hidden multiple disabled={subiendo} onChange={alElegirArchivos} />
          </label>
          {error && <p className="aviso error sin-margen">{error}</p>}
          <button type="button" className="boton secundario" onClick={cerrar}>Cancelar</button>
        </div>
      )}
    </>
  )
}

// Un adjunto: el link o la ubicación se abren (la ubicación, en Google Maps); la foto se ve en grande; el audio suena
// ahí mismo; el archivo se abre.
function BotonAdjunto({ adjunto: a }) {
  const conArchivo = !!a.ruta
  const [url, setUrl] = useState(conArchivo ? null : a.url)
  const [error, setError] = useState(false)
  const [fotoGrande, setFotoGrande] = useState(false)
  const [sonando, setSonando] = useState(false)
  const audio = useRef(null)
  useAtras(fotoGrande, () => setFotoGrande(false))

  useEffect(() => {
    if (!conArchivo) return
    let vigente = true
    urlDeArchivo(a.ruta).then((u) => { if (vigente) setUrl(u) }).catch(() => { if (vigente) setError(true) })
    return () => { vigente = false }
  }, [a.ruta, conArchivo])

  // Si se cierra la pantalla, el audio deja de sonar.
  useEffect(() => () => audio.current?.pause(), [])

  function alternarAudio() {
    if (!audio.current) {
      audio.current = new Audio(url)
      audio.current.onended = () => setSonando(false)
      audio.current.onerror = () => { setSonando(false); setError(true) }
    }
    if (sonando) { audio.current.pause(); setSonando(false) }
    else { audio.current.play().then(() => setSonando(true)).catch(() => setError(true)) }
  }

  if (error) return <span className="adjunto con-error">⚠️ No se pudo abrir</span>
  if (!url) return <span className="adjunto">{textoAdjunto(a)}…</span>

  if (a.tipo === 'foto') {
    return (
      <>
        <button type="button" className="adjunto" onClick={() => setFotoGrande(true)}>{textoAdjunto(a)}</button>
        {fotoGrande && (
          <button type="button" className="foto-pantalla-completa" onClick={() => setFotoGrande(false)} aria-label="Cerrar la foto">
            <img src={url} alt="Foto adjunta" />
            <span>Tocá para cerrar</span>
          </button>
        )}
      </>
    )
  }
  if (a.tipo === 'audio') {
    return (
      <button type="button" className={'adjunto' + (sonando ? ' sonando' : '')} onClick={alternarAudio}>
        {sonando ? '⏸️ Pausar audio' : textoAdjunto(a)}
      </button>
    )
  }
  return <a className="adjunto" href={url} target="_blank" rel="noreferrer"><span>{textoAdjunto(a)}</span></a>
}
