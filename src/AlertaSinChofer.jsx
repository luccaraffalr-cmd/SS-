import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { hora, problemaDelViaje, recorridoDebajo, tituloViaje } from './viajes.js'
import ElegirChofer, { useChoferesParaAsignar } from './ElegirChofer.jsx'

const CONSULTA = 'id, estado, tipo, origen, destino, cliente_nombre, hora_presentacion, hora_asignacion, iniciado_en,'
  + ' asignado_por, espera_gestion, choferes_excluidos, chofer:perfiles!viajes_chofer_id_fkey(nombre, telefono),'
  + ' rechazo:perfiles!viajes_rechazado_por_fkey(nombre)'

// Cartel rojo arriba de todo el panel de gestión con los viajes que ya llegaron a su hora y:
// no tienen chofer, el chofer no aceptó la asignación, o la aceptó pero no salió a hacerlo.
// Al tocarlo se abre la lista para llamar al chofer o asignárselo a otro ahí mismo.
export default function AlertaSinChofer({ onVer }) {
  const [viajes, setViajes] = useState([])
  const [ahora, setAhora] = useState(Date.now())

  useEffect(() => {
    const cargar = () => supabase.from('viajes').select(CONSULTA)
      .in('estado', ['sin_chofer', 'ofrecido', 'asignado']).is('iniciado_en', null)
      .lte('hora_asignacion', new Date().toISOString())
      .then(({ data }) => setViajes(data ?? []))
    cargar()
    const canal = supabase.channel('alerta-sin-chofer')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'viajes' }, cargar)
      .subscribe()
    // Cada 30 segundos: los programados que llegan a su hora de asignación.
    const reloj = setInterval(() => { setAhora(Date.now()); cargar() }, 30 * 1000)
    return () => { supabase.removeChannel(canal); clearInterval(reloj) }
  }, [])

  return <CartelAlertas viajes={viajes} ahora={ahora} onVer={onVer} />
}

const TITULOS = {
  sin_chofer: (n) => `${n} ${n === 1 ? 'viaje' : 'viajes'} sin chofer`,
  no_salio: (n) => `${n} ${n === 1 ? 'chofer no salió' : 'choferes no salieron'}`,
  sin_aceptar: (n) => `${n} sin aceptar`,
}

// La parte que se ve (separada de la carga de datos).
export function CartelAlertas({ viajes, ahora, onVer }) {
  const [abierto, setAbierto] = useState(false)
  const conProblema = viajes
    .map((v) => ({ ...v, problema: problemaDelViaje(v, ahora) }))
    .filter((v) => v.problema)
    .sort((a, b) => new Date(a.hora_presentacion ?? a.hora_asignacion) - new Date(b.hora_presentacion ?? b.hora_asignacion))
  if (conProblema.length === 0) return null

  const minutosPara = (fecha) => Math.round((new Date(fecha).getTime() - ahora) / 60000)
  const cuando = (v) => {
    if (v.tipo !== 'programado') return `⚡ Para ya (desde ${hora(v.hora_asignacion)})`
    const min = minutosPara(v.hora_presentacion)
    const texto = min > 0 ? `en ${min} min` : min === 0 ? 'ya' : `hace ${-min} min`
    return `📅 Presentarse ${hora(v.hora_presentacion)} (${texto})`
  }
  const resumen = (v) => (v.problema === 'no_salio' ? `⏰ ${v.chofer?.nombre} no salió · `
    : v.problema === 'sin_aceptar' ? `⏳ ${v.chofer?.nombre} no aceptó · ` : '') + cuando(v)
  const titulo = Object.keys(TITULOS)
    .map((p) => [p, conProblema.filter((v) => v.problema === p).length])
    .filter(([, n]) => n > 0)
    .map(([p, n]) => TITULOS[p](n))
    .join(' · ')

  return (
    <div>
      <button className="alerta-sin-chofer" onClick={() => setAbierto(!abierto)}>
        <strong>⚠️ {titulo}</strong>
        <span className="detalle">
          {abierto ? 'Tocá para cerrar' : conProblema.slice(0, 3).map((v) => <span key={v.id}>{resumen(v)}</span>)}
        </span>
      </button>
      {abierto && (
        <PanelAsignar viajes={conProblema} cuando={cuando} onVer={() => { setAbierto(false); onVer() }} />
      )}
    </div>
  )
}

// Lista de los viajes con problema: llamar al chofer y/o asignárselo a otro.
function PanelAsignar({ viajes, cuando, onVer }) {
  const choferes = useChoferesParaAsignar() // se carga al abrir, así está al día
  const [elegidos, setElegidos] = useState({})
  const [error, setError] = useState('')

  async function asignar(viaje) {
    setError('')
    const chofer = elegidos[viaje]
    if (!chofer) return setError('Elegí un chofer.')
    const { error } = await supabase.rpc('asignar_viaje', { viaje, chofer })
    if (error) setError('No se pudo asignar: ' + error.message)
  }

  return (
    <div className="panel-alerta">
      {error && <p className="aviso error sin-margen">{error}</p>}
      {viajes.map((v) => (
        <div key={v.id} className="viaje-alerta">
          <strong className="viaje-titulo">{tituloViaje(v)}</strong>
          {recorridoDebajo(v) && <span>{recorridoDebajo(v)}</span>}
          <span className="viaje-cuando">{cuando(v)} · #{v.id}</span>
          {v.problema === 'sin_chofer' && v.espera_gestion && (
            <small className="rechazado">❌ Lo rechazó {v.rechazo?.nombre ?? 'un chofer'}</small>
          )}
          {v.problema === 'no_salio' && (
            <small className="rechazado">⏰ {v.chofer?.nombre} lo aceptó pero todavía no salió (se habilitó a las {hora(v.hora_asignacion)})</small>
          )}
          {v.problema === 'sin_aceptar' && (
            <small className="rechazado">⏳ Asignado a {v.chofer?.nombre}, que todavía no lo aceptó</small>
          )}
          {v.problema !== 'sin_chofer' && v.chofer?.telefono && (
            <a className="boton secundario" href={'tel:' + v.chofer.telefono}>📞 Llamar a {v.chofer.nombre}</a>
          )}
          <div className="asignar-rapido">
            <ElegirChofer valor={elegidos[v.id] ?? ''} choferes={choferes} excluidos={v.choferes_excluidos ?? []}
              textoVacio={v.problema === 'sin_chofer' ? 'Elegir chofer…' : 'Pasárselo a otro chofer…'}
              onCambiar={(c) => setElegidos({ ...elegidos, [v.id]: c })} />
            <button className="boton" onClick={() => asignar(v.id)}>Asignar</button>
          </div>
        </div>
      ))}
      <button className="boton secundario" onClick={onVer}>Ver todos los viajes</button>
    </div>
  )
}
