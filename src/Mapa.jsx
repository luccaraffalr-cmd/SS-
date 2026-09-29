import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { NOMBRE_ESTADO, haceCuanto } from './estados.js'
import { crearMapa, crearMarcador, iconoAuto, sinSenal } from './mapa.js'

const ORDEN_ESTADO = { en_viaje: 0, en_cola: 1, libre: 2, fuera_de_servicio: 3 }

// De dónde llega la ubicación de cada chofer: la app propia y/o Traccar Client.
function fuentes(c, ubicaciones) {
  return [
    { origen: 'App', u: ubicaciones['app:' + c.id] },
    { origen: 'Traccar', u: c.equipo_traccar ? ubicaciones[c.equipo_traccar] : undefined, equipo: c.equipo_traccar },
  ].filter((f) => f.u || f.equipo)
}

// La más reciente de las dos (la que se muestra en el mapa).
function masReciente(c, ubicaciones) {
  return fuentes(c, ubicaciones).map((f) => f.u).filter(Boolean)
    .sort((a, b) => new Date(b.reportado_en) - new Date(a.reportado_en))[0]
}

// Gestión: mapa con todos los autos en vivo (la ubicación la manda Traccar Client).
export default function Mapa() {
  const elementoMapa = useRef(null)
  const mapa = useRef(null)
  const marcadores = useRef({}) // chofer id -> marcador
  const yaEncuadro = useRef(false)
  const [choferes, setChoferes] = useState(null)
  const [ubicaciones, setUbicaciones] = useState({}) // equipo -> fila
  const [ahora, setAhora] = useState(Date.now())

  useEffect(() => {
    mapa.current = crearMapa(elementoMapa.current)
    return () => { mapa.current.remove(); mapa.current = null; marcadores.current = {} }
  }, [])

  useEffect(() => {
    async function cargarChoferes() {
      const { data } = await supabase.from('choferes').select('id, estado, oculto, equipo_traccar, patente, perfiles(nombre, activo)')
      setChoferes((data ?? []).filter((c) => c.perfiles?.activo)
        .sort((a, b) => (ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]) || a.perfiles.nombre.localeCompare(b.perfiles.nombre)))
    }
    async function cargarUbicaciones() {
      const { data } = await supabase.from('ubicaciones').select('*')
      setUbicaciones(Object.fromEntries((data ?? []).map((u) => [u.equipo, u])))
    }
    cargarChoferes()
    cargarUbicaciones()
    const canal = supabase.channel('gestion-mapa')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'choferes' }, cargarChoferes)
      .subscribe()
    // Las ubicaciones se piden cada 15 s (no en vivo): recibir cada movimiento de cada auto
    // gastaría el cupo gratis de mensajes en vivo de Supabase.
    const reloj = setInterval(() => { setAhora(Date.now()); cargarUbicaciones() }, 15 * 1000)
    return () => { supabase.removeChannel(canal); clearInterval(reloj) }
  }, [])

  // Pone, mueve o saca los autos del mapa.
  useEffect(() => {
    if (!mapa.current || !choferes) return
    const quedan = new Set()
    for (const c of choferes) {
      const u = masReciente(c, ubicaciones)
      if (!u) continue
      quedan.add(c.id)
      const icono = iconoAuto(c.perfiles.nombre, c.estado + (sinSenal(u.reportado_en, ahora) ? ' sin-senal' : ''))
      const m = marcadores.current[c.id]
      if (m) m.setLatLng([u.lat, u.lon]).setIcon(icono)
      else marcadores.current[c.id] = crearMarcador(u.lat, u.lon, icono).addTo(mapa.current)
    }
    for (const id of Object.keys(marcadores.current)) {
      if (!quedan.has(id)) { marcadores.current[id].remove(); delete marcadores.current[id] }
    }
    // La primera vez, encuadra el mapa para que se vean todos los autos.
    const puntos = Object.values(marcadores.current).map((m) => m.getLatLng())
    if (!yaEncuadro.current && puntos.length > 0) {
      yaEncuadro.current = true
      mapa.current.fitBounds(puntos, { padding: [40, 40], maxZoom: 15 })
    }
  }, [choferes, ubicaciones, ahora])

  function centrar(c) {
    const m = marcadores.current[c.id]
    if (!m) return
    mapa.current.setView(m.getLatLng(), 16)
    elementoMapa.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const conUbicacion = (choferes ?? []).filter((c) => fuentes(c, ubicaciones).length > 0)
  const sinUbicacion = (choferes ?? []).filter((c) => fuentes(c, ubicaciones).length === 0)

  return (
    <main className="pantalla">
      <h1>Mapa</h1>
      <div ref={elementoMapa} className="mapa" />

      {choferes === null && <p>Cargando…</p>}
      <ul className="lista">
        {conUbicacion.map((c) => {
          const lista = fuentes(c, ubicaciones)
          return (
            <li key={c.id}>
              <button className="fila" onClick={() => centrar(c)} disabled={!masReciente(c, ubicaciones)}>
                <span>
                  <strong>{c.perfiles.nombre}{c.oculto && <span className="etiqueta oculto">Oculto</span>}</strong>
                  {lista.map(({ origen, u, equipo }) => {
                    const cortado = u && sinSenal(u.reportado_en, ahora)
                    const quien = lista.length > 1 ? `${origen}: ` : ''
                    return (
                      <small key={origen} className={cortado ? 'texto-alerta' : ''}>
                        {u ? `📍 ${quien}Ubicación ${haceCuanto(u.reportado_en, ahora)}${cortado ? ' ⚠️' : ''}${u.velocidad > 4 && !cortado ? ` · ${u.velocidad} km/h` : ''}`
                          : `Traccar n.º ${equipo}: todavía no mandó ubicación`}
                      </small>
                    )
                  })}
                </span>
                <span className={'etiqueta estado ' + c.estado}>{NOMBRE_ESTADO[c.estado]}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {sinUbicacion.length > 0 && (
        <p className="ayuda separada">
          Sin ubicación (no aparecen en el mapa): {sinUbicacion.map((c) => c.perfiles.nombre).join(', ')}.
          Aparecen cuando comparten desde la app, o si usan Traccar Client, cargando su número en Usuarios → el chofer.
        </p>
      )}
    </main>
  )
}
