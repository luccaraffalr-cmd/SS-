import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { hora } from './viajes.js'
import ElegirChofer, { useChoferesParaAsignar } from './ElegirChofer.jsx'

// Cartel rojo arriba de todo el panel de gestión cuando hay viajes que ya se tendrían
// que estar haciendo y no tienen chofer. Al tocarlo se abre la lista para asignarlos ahí mismo.
export default function AlertaSinChofer({ onVer }) {
  const [viajes, setViajes] = useState([])
  const [ahora, setAhora] = useState(Date.now())
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    const cargar = () => supabase.from('viajes')
      .select('id, tipo, origen, destino, cliente_nombre, hora_presentacion, hora_asignacion, espera_gestion, rechazo:perfiles!viajes_rechazado_por_fkey(nombre)')
      .eq('estado', 'sin_chofer').lte('hora_asignacion', new Date().toISOString())
      .then(({ data }) => setViajes(data ?? []))
    cargar()
    const canal = supabase.channel('alerta-sin-chofer')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'viajes' }, cargar)
      .subscribe()
    // Cada 30 segundos: los programados que llegan a su hora de asignación.
    const reloj = setInterval(() => { setAhora(Date.now()); cargar() }, 30 * 1000)
    return () => { supabase.removeChannel(canal); clearInterval(reloj) }
  }, [])

  if (viajes.length === 0) return null

  const minutosPara = (fecha) => Math.round((new Date(fecha).getTime() - ahora) / 60000)
  const cuando = (v) => {
    if (v.tipo !== 'programado') return `⚡ Para ya (desde ${hora(v.hora_asignacion)})`
    const min = minutosPara(v.hora_presentacion)
    const texto = min > 0 ? `en ${min} min` : min === 0 ? 'ya' : `hace ${-min} min`
    return `📅 Presentarse ${hora(v.hora_presentacion)} (${texto})`
  }
  const ordenados = [...viajes].sort((a, b) =>
    new Date(a.hora_presentacion ?? a.hora_asignacion) - new Date(b.hora_presentacion ?? b.hora_asignacion))

  return (
    <div>
      <button className="alerta-sin-chofer" onClick={() => setAbierto(!abierto)}>
        <strong>⚠️ {viajes.length} {viajes.length === 1 ? 'viaje' : 'viajes'} sin chofer</strong>
        <span className="detalle">
          {abierto ? 'Tocá para cerrar' : ordenados.slice(0, 3).map((v) => <span key={v.id}>{cuando(v)}</span>)}
        </span>
      </button>
      {abierto && (
        <PanelAsignar viajes={ordenados} cuando={cuando} onVer={() => { setAbierto(false); onVer() }} />
      )}
    </div>
  )
}

// Lista de viajes sin chofer con un selector y "Asignar" en cada uno.
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
          <strong>{cuando(v)} · #{v.id}</strong>
          <span>{v.origen}{v.destino ? ' → ' + v.destino : ''}</span>
          {v.cliente_nombre && <small>{v.cliente_nombre}</small>}
          {v.espera_gestion && <small className="rechazado">❌ Lo rechazó {v.rechazo?.nombre ?? 'un chofer'}</small>}
          <div className="asignar-rapido">
            <ElegirChofer valor={elegidos[v.id] ?? ''} choferes={choferes} textoVacio="Elegir chofer…"
              onCambiar={(c) => setElegidos({ ...elegidos, [v.id]: c })} />
            <button className="boton" onClick={() => asignar(v.id)}>Asignar</button>
          </div>
        </div>
      ))}
      <button className="boton secundario" onClick={onVer}>Ver todos los viajes</button>
    </div>
  )
}
