import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'
import { adjuntoDeLink, esUbicacion, leerLink, subirArchivo } from './adjuntos.js'
import { archivoCompartido } from './compartidoApp.js'
import { useAtras } from './atras.js'
import { cuando, recorridoDebajo, tituloViaje } from './viajes.js'

const PARTES = [['origen', 'Buscar en'], ['destino', 'Destino'], ['observaciones', 'Observaciones']]
const ES_AUDIO = /\.(opus|ogg|oga|mp3|m4a|aac|wav|amr)$/i

// Qué llegó, en palabras.
function queEs(compartido) {
  const a = compartido.archivo
  if (a) {
    if (a.tipo.startsWith('image/')) return '🖼️ Una foto'
    if (a.tipo.startsWith('audio/') || a.tipo === 'application/ogg' || ES_AUDIO.test(a.nombre)) return '🔊 Un audio'
    return `📄 ${a.nombre}`
  }
  const link = leerLink(compartido.texto)
  if (!link) return '📝 Un texto (va a las observaciones)'
  return esUbicacion(link) ? '📍 Una ubicación' : '🔗 Un link'
}

// "Compartir desde WhatsApp" (22/10/2026): WhatsApp → Compartir → Senda Segura abre esta pantalla. Se elige el viaje y la
// parte (Buscar en, Destino u Observaciones) y queda como adjunto de esa parte, igual que con "Agregar" al cargar el viaje.
// Un texto sin link se suma a las observaciones. Solo gestión.
export default function AgregarCompartido({ compartido, perfil, onListo }) {
  useAtras(true, onListo)
  const [viajes, setViajes] = useState(null)
  const [elegido, setElegido] = useState(null)
  const [campo, setCampo] = useState('')
  const [nombre, setNombre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState(null)

  const archivo = compartido.archivo
  const link = archivo ? null : leerLink(compartido.texto)
  const soloTexto = !archivo && !link
  const esGestion = perfil.rol !== 'chofer'

  useEffect(() => {
    if (!esGestion || compartido.error) return
    supabase.from('viajes')
      .select('id, tipo, estado, origen, destino, cliente_nombre, hora_presentacion, hora_asignacion, chofer:perfiles!viajes_chofer_id_fkey(nombre)')
      .in('estado', ['sin_chofer', 'ofrecido', 'asignado'])
      .order('hora_asignacion').limit(80)
      .then(({ data, error }) => {
        if (error) setError('No se pudieron cargar los viajes: ' + error.message)
        setViajes((data ?? []).sort((a, b) =>
          new Date(a.hora_presentacion ?? a.hora_asignacion) - new Date(b.hora_presentacion ?? b.hora_asignacion)))
      })
  }, [esGestion, compartido.error])

  const foto = useMemo(() => (archivo?.tipo.startsWith('image/') ? `data:${archivo.tipo};base64,${archivo.base64}` : null),
    [archivo])

  async function agregar() {
    setError('')
    const parte = soloTexto ? 'observaciones' : campo
    if (!parte) return setError('Elegí en qué parte del viaje va.')
    setEnviando(true)
    try {
      // Se lee el viaje de nuevo, por si alguien lo cambió mientras tanto.
      const { data: actual, error: errLeer } = await supabase.from('viajes')
        .select('adjuntos, observaciones').eq('id', elegido.id).single()
      if (errLeer) throw new Error(errLeer.message)
      let cambios
      if (soloTexto) {
        cambios = { observaciones: [actual.observaciones, compartido.texto.trim()].filter(Boolean).join('\n') }
      } else {
        const nuevo = archivo ? await subirArchivo(parte, archivoCompartido(archivo)) : adjuntoDeLink(parte, compartido.texto, nombre)
        cambios = { adjuntos: [...(actual.adjuntos ?? []), nuevo] }
      }
      const { error } = await supabase.from('viajes').update(cambios).eq('id', elegido.id)
      if (error) throw new Error(error.message)
      setHecho(elegido)
    } catch (e) {
      setError('No se pudo agregar: ' + e.message)
    }
    setEnviando(false)
  }

  if (!esGestion || compartido.error) {
    return (
      <main className="pantalla">
        <h1>📎 Compartir</h1>
        <p className="aviso error">
          {compartido.error ? `No se pudo leer lo que compartiste: ${compartido.error}` : 'Solo gestión puede agregar cosas a los viajes.'}
        </p>
        <button className="boton" onClick={onListo}>Volver</button>
      </main>
    )
  }

  if (hecho) {
    return (
      <main className="pantalla">
        <h1>✅ Listo</h1>
        <p className="aviso ok">
          Se agregó al viaje #{hecho.id}: <strong>{tituloViaje(hecho)}</strong>.
          {!soloTexto && hecho.chofer?.nombre && ['ofrecido', 'asignado'].includes(hecho.estado) && (
            <> A {hecho.chofer.nombre} le llega un aviso.</>
          )}
        </p>
        <button className="boton" onClick={onListo}>Listo</button>
      </main>
    )
  }

  return (
    <main className="pantalla">
      <h1>📎 Agregar a un viaje</h1>
      <section className="tarjeta">
        <p className="sin-margen"><strong>{queEs(compartido)}</strong></p>
        {foto && <img className="foto-compartida" src={foto} alt="Foto compartida" />}
        {compartido.texto && <p className="texto-compartido sin-margen">{compartido.texto}</p>}
        {link && !esUbicacion(link) && (
          <label>Nombre (opcional)<input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="ej: Autorización" /></label>
        )}
      </section>

      {!elegido ? (
        <section className="tarjeta separada">
          <h2>¿A qué viaje?</h2>
          {viajes === null && <p className="sin-margen">Cargando…</p>}
          {viajes?.length === 0 && <p className="ayuda sin-margen">No hay viajes sin terminar.</p>}
          <ul className="lista-elegir">
            {viajes?.map((v) => (
              <li key={v.id}>
                <button type="button" className="opcion-viaje" onClick={() => setElegido(v)}>
                  <strong className="viaje-titulo">{tituloViaje(v)}</strong>
                  {recorridoDebajo(v) && <span>{recorridoDebajo(v)}</span>}
                  <small>{cuando(v)} · #{v.id}{v.chofer?.nombre ? ` · ${v.chofer.nombre}` : ' · sin chofer'}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="tarjeta separada">
          <h2>Viaje</h2>
          <div className="opcion-viaje elegida">
            <strong className="viaje-titulo">{tituloViaje(elegido)}</strong>
            {recorridoDebajo(elegido) && <span>{recorridoDebajo(elegido)}</span>}
            <small>{cuando(elegido)} · #{elegido.id}</small>
          </div>
          <button type="button" className="boton secundario" onClick={() => { setElegido(null); setCampo('') }}>Elegir otro viaje</button>
          {!soloTexto && (
            <div>
              <p className="etiqueta-campo">¿En qué parte va?</p>
              <div className="selector-tipo selector-repetir">
                {PARTES.map(([id, texto]) => (
                  <button key={id} type="button" className={campo === id ? 'activo' : ''} onClick={() => setCampo(id)}>{texto}</button>
                ))}
              </div>
            </div>
          )}
          {error && <p className="aviso error sin-margen">{error}</p>}
          <button type="button" className="boton verde" disabled={enviando} onClick={agregar}>
            {enviando ? 'Agregando…' : 'Agregar al viaje'}
          </button>
        </section>
      )}
      {!elegido && error && <p className="aviso error">{error}</p>}
      <button className="boton secundario" onClick={onListo}>Cancelar</button>
    </main>
  )
}
