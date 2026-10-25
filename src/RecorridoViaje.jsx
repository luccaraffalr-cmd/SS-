import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { crearCapa, crearMapa, dibujarRecorrido } from './mapa.js'
import { hora } from './viajes.js'
import { useAtras } from './atras.js'

const CADA_CUANTO = 30 * 1000

// "1 h 05 min" / "35 min"
function duracion(minutos) {
  const m = Number(minutos ?? 0)
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`
}

// Gestión: recorrido del viaje (pedido del dueño, 24/10/2026), desde "Salir a hacer el viaje" hasta que lo finaliza:
// mapa, km, duración y demora (las veces que estuvo detenido 3 minutos o más, en rojo en el mapa; aproximado).
// La línea va de celeste (principio) a azul oscuro (final). Se puede ver en grande. Si se está haciendo, se actualiza solo.
export default function RecorridoViaje({ viajeId, enCurso }) {
  const elementoMapa = useRef(null)
  const mapa = useRef(null)
  const capa = useRef(null)
  const encuadrado = useRef(false) // el mapa se encuadra solo la primera vez
  const [datos, setDatos] = useState(undefined) // undefined = cargando; null = sin recorrido
  const [error, setError] = useState('')
  const [grande, setGrande] = useState(false)
  useAtras(grande, () => setGrande(false))

  useEffect(() => {
    const cargar = () => supabase.rpc('ver_recorrido', { p_viaje: viajeId }).then(({ data, error }) => {
      if (error) setError(error.message)
      else setDatos(data ?? null)
    })
    cargar()
    if (!enCurso) return
    const reloj = setInterval(cargar, CADA_CUANTO)
    return () => clearInterval(reloj)
  }, [viajeId, enCurso])

  const puntos = datos?.puntos ?? []
  const hayMapa = puntos.length > 0

  // El mapa se crea una vez; si el viaje se está haciendo, se redibuja el recorrido sin moverlo (para no perder el zoom).
  useEffect(() => {
    if (!hayMapa) return
    if (!mapa.current) {
      mapa.current = crearMapa(elementoMapa.current)
      capa.current = crearCapa(mapa.current)
    }
    capa.current.clearLayers()
    const paradas = (datos.paradas ?? []).map((p) => ({
      ...p, texto: `Detenido ${duracion(p.minutos)} (de ${hora(p.desde)} a ${hora(p.hasta)})`,
    }))
    const area = dibujarRecorrido(capa.current, puntos, paradas, datos.en_curso)
    if (!encuadrado.current) {
      mapa.current.fitBounds(area, { padding: [24, 24], maxZoom: 16 })
      encuadrado.current = true
    }
  }, [datos]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { mapa.current?.remove(); mapa.current = null }, [])

  // Al agrandar o achicar, el mapa se acomoda al lugar nuevo.
  useEffect(() => {
    if (!mapa.current) return
    const espera = setTimeout(() => mapa.current?.invalidateSize(), 50)
    return () => clearTimeout(espera)
  }, [grande])

  const demora = datos?.demora_min ?? datos?.parado_min
  return (
    <div className="tarjeta separada">
      <h2>🗺️ Recorrido{datos?.en_curso && ' (hasta ahora)'}</h2>
      {error && <p className="aviso error sin-margen">No se pudo cargar el recorrido: {error}</p>}
      {datos === undefined && !error && <p className="sin-margen">Cargando…</p>}
      {datos !== undefined && !hayMapa && !error && (
        <p className="ayuda sin-margen">
          No hay ubicaciones de este viaje: el celular del chofer no mandó la ubicación, o el viaje es de antes del 24/10/2026
          (las ubicaciones se guardan 7 días).
        </p>
      )}
      {hayMapa && (
        <>
          <div className="datos-recorrido">
            <span><strong>{String(datos.km).replace('.', ',')} km</strong></span>
            <span>⏱️ {duracion(datos.minutos)}</span>
            <span className={demora > 0 ? 'texto-demora' : ''}>🔴 Demora {duracion(demora)}</span>
          </div>
          <div className={'recorrido-mapa' + (grande ? ' en-grande' : '')}>
            <div ref={elementoMapa} className="mapa mapa-recorrido" />
            <button type="button" className="boton-mapa" onClick={() => setGrande(!grande)}>
              {grande ? '✕ Cerrar' : '⛶ Ver en grande'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
