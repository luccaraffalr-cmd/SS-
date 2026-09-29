import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { urlFotoAuto } from './fotos.js'
import { crearMapa, crearMarcador, iconoAuto } from './mapa.js'

const CADA_CUANTO = 5 * 1000

// Qué dice la barra de abajo según lo que devuelve el servidor.
function textos(d) {
  if (!d) return ['Cargando…', '']
  if (d.estado === 'inexistente') return ['Link no válido', 'Pedile uno nuevo a la remisería.']
  if (d.estado === 'terminado') return ['Viaje terminado', 'Este link ya no muestra el auto.']
  if (d.estado === 'sin_chofer') return ['Buscando chofer', 'Todavía no hay un auto asignado a tu viaje.']
  if (d.lat == null) return ['Buscando el auto', 'Esperando la señal del GPS.']
  if (d.segundos > 120) return ['Última ubicación conocida', `Sin señal hace ${Math.round(d.segundos / 60)} min.`]
  if (d.velocidad > 4) return ['Tu remis está en camino', `${d.velocidad} km/h`]
  return ['Tu remis está detenido', 'Actualizado recién.']
}

// Página pública del link de seguimiento (/seguir/<código>): el pasajero no necesita usuario.
export default function Seguimiento({ codigo }) {
  const elementoMapa = useRef(null)
  const mapa = useRef(null)
  const marcador = useRef(null)
  const seguir = useRef(true) // si el pasajero mueve el mapa, deja de centrarlo solo
  const [datos, setDatos] = useState(null)

  useEffect(() => {
    document.title = 'Tu remis'
    mapa.current = crearMapa(elementoMapa.current)
    mapa.current.on('dragstart', () => { seguir.current = false })
    return () => { mapa.current.remove(); mapa.current = null; marcador.current = null }
  }, [])

  useEffect(() => {
    let activo = true
    async function actualizar() {
      const { data, error } = await supabase.rpc('ver_seguimiento', { codigo })
      if (!activo || error) return
      setDatos(data)
      if (data.estado !== 'activo' || data.lat == null) {
        marcador.current?.remove()
        marcador.current = null
        return
      }
      if (!marcador.current) {
        marcador.current = crearMarcador(data.lat, data.lon, iconoAuto()).addTo(mapa.current)
        mapa.current.setView([data.lat, data.lon], 16)
      } else {
        marcador.current.setLatLng([data.lat, data.lon])
        if (seguir.current) mapa.current.panTo([data.lat, data.lon])
      }
    }
    actualizar()
    const intervalo = setInterval(actualizar, CADA_CUANTO)
    return () => { activo = false; clearInterval(intervalo) }
  }, [codigo])

  function centrar() {
    seguir.current = true
    if (marcador.current) mapa.current.setView(marcador.current.getLatLng(), 16)
  }

  const [titulo, detalle] = textos(datos)
  const auto = [datos?.modelo, datos?.color].filter(Boolean).join(' · ')

  return (
    <div className="seguimiento">
      <div ref={elementoMapa} className="seguimiento-mapa" />
      <div className="seguimiento-barra">
        {datos?.estado === 'activo' && (
          <div className="seguimiento-auto">
            {datos.foto && <img src={urlFotoAuto(datos.foto)} alt="Foto del auto" />}
            <div>
              <strong>{datos.chofer}</strong>
              {auto && <span>{auto}</span>}
              {datos.patente && <span className="patente">{datos.patente}</span>}
            </div>
          </div>
        )}
        <div className="seguimiento-estado">
          <div>
            <strong>{titulo}</strong>
            <small>{detalle}</small>
          </div>
          {datos?.estado === 'activo' && datos.lat != null && <button className="boton" onClick={centrar}>Centrar</button>}
        </div>
      </div>
    </div>
  )
}
