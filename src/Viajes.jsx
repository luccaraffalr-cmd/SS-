import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import FormViaje from './FormViaje.jsx'
import {
  NOMBRE_ESTADO_VIAJE, esAsignableSinChofer, fechaCorta, fechaLocal, hora, tiempoRestante, unirFechaHora,
} from './viajes.js'

const ACTIVOS = ['sin_chofer', 'ofrecido', 'asignado']
const CONSULTA = '*, chofer:perfiles!viajes_chofer_id_fkey(nombre), rechazo:perfiles!viajes_rechazado_por_fkey(nombre)'

// Gestión: todos los viajes con su estado, con filtros por fecha, estado y chofer.
export default function Viajes() {
  const [viajes, setViajes] = useState(null)
  const [choferes, setChoferes] = useState([])
  const [editando, setEditando] = useState(null) // null = lista; 'nuevo' = alta; objeto = edición
  const [filtroFecha, setFiltroFecha] = useState(fechaLocal())
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroChofer, setFiltroChofer] = useState('')
  const [ahora, setAhora] = useState(Date.now())
  const [errorCarga, setErrorCarga] = useState('')

  const cargar = useCallback(async () => {
    let consulta = supabase.from('viajes').select(CONSULTA)
    if (filtroFecha) {
      const desde = unirFechaHora(filtroFecha, '00:00')
      const hasta = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate() + 1)
      consulta = consulta.gte('hora_asignacion', desde.toISOString()).lt('hora_asignacion', hasta.toISOString())
    }
    if (filtroEstado) consulta = consulta.eq('estado', filtroEstado)
    if (filtroChofer === 'ninguno') consulta = consulta.is('chofer_id', null)
    else if (filtroChofer) consulta = consulta.eq('chofer_id', filtroChofer)

    const { data, error } = await consulta.limit(500)
    setErrorCarga(error ? error.message : '')
    // Primero los activos (del más próximo al más lejano), después el resto (el más reciente arriba).
    setViajes((data ?? []).sort((a, b) => {
      const activoA = ACTIVOS.includes(a.estado), activoB = ACTIVOS.includes(b.estado)
      if (activoA !== activoB) return activoA ? -1 : 1
      const dif = new Date(a.hora_asignacion) - new Date(b.hora_asignacion)
      return activoA ? dif : -dif
    }))
  }, [filtroFecha, filtroEstado, filtroChofer])

  useEffect(() => {
    cargar()
    const canal = supabase.channel('gestion-viajes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'viajes' }, cargar)
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [cargar])

  useEffect(() => {
    supabase.from('perfiles').select('id, nombre').eq('rol', 'chofer').eq('activo', true).order('nombre')
      .then(({ data }) => setChoferes(data ?? []))
    // Cada pocos segundos: actualiza las cuentas regresivas y le pide al servidor que pase
    // al siguiente chofer las ofertas vencidas (sin esperar al minuto del servidor).
    const reloj = setInterval(() => setAhora(Date.now()), 5 * 1000)
    const revisar = setInterval(() => supabase.rpc('revisar_asignaciones'), 20 * 1000)
    return () => { clearInterval(reloj); clearInterval(revisar) }
  }, [])

  if (editando) {
    return <FormViaje viaje={editando === 'nuevo' ? null : editando} onListo={() => { setEditando(null); cargar() }} />
  }

  return (
    <main className="pantalla">
      <h1>Viajes</h1>
      <button className="boton" onClick={() => setEditando('nuevo')}>+ Nuevo viaje</button>

      <div className="filtros">
        <label>
          Fecha
          <input type="date" value={filtroFecha} onChange={(e) => setFiltroFecha(e.target.value)} />
        </label>
        <div className="botones-rapidos">
          <button className={filtroFecha === fechaLocal() ? 'activo' : ''} onClick={() => setFiltroFecha(fechaLocal())}>Hoy</button>
          <button className={filtroFecha === '' ? 'activo' : ''} onClick={() => setFiltroFecha('')}>Todas las fechas</button>
        </div>
        <label>
          Estado
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(NOMBRE_ESTADO_VIAJE).map(([id, texto]) => <option key={id} value={id}>{texto}</option>)}
          </select>
        </label>
        <label>
          Chofer
          <select value={filtroChofer} onChange={(e) => setFiltroChofer(e.target.value)}>
            <option value="">Todos</option>
            <option value="ninguno">Sin chofer</option>
            {choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      </div>

      {viajes === null && <p>Cargando…</p>}
      {errorCarga && <p className="aviso error">No se pudieron cargar los viajes: {errorCarga}</p>}
      {!errorCarga && viajes?.length === 0 && <p className="ayuda">No hay viajes con estos filtros.</p>}
      <ul className="lista">
        {viajes?.map((v) => {
          const urgente = esAsignableSinChofer(v, ahora)
          const esperando = v.estado === 'sin_chofer' && !urgente
          // Asignado a mano por gestión (chofer elegido o reasignado): chofer fijo, en naranja.
          const fijo = ['ofrecido', 'asignado'].includes(v.estado) && v.asignado_por
          const etiqueta = v.estado === 'sin_chofer' && v.espera_gestion ? 'Rechazado: decidir'
            : esperando ? `Se asigna ${hora(v.hora_asignacion)}`
            : v.estado === 'ofrecido' && v.oferta_vence ? `Ofrecido · ${tiempoRestante(v.oferta_vence, ahora)}`
            : v.estado === 'asignado' && !v.iniciado_en ? 'Aceptado'
            : v.estado === 'asignado' ? 'En viaje'
            : NOMBRE_ESTADO_VIAJE[v.estado]
          return (
            <li key={v.id}>
              <button className={'tarjeta-viaje' + (urgente ? ' urgente' : '') + (fijo ? ' fijo' : '')}
                onClick={() => setEditando(v)}>
                <div className="viaje-arriba">
                  <span className="viaje-hora">
                    {v.prioritario && ['sin_chofer', 'ofrecido'].includes(v.estado) && '⭐ '}
                    {v.tipo === 'programado' ? hora(v.hora_presentacion) : hora(v.hora_asignacion)}
                    {!filtroFecha && <small> {fechaCorta(v.hora_asignacion)}</small>}
                  </span>
                  <span className={'etiqueta viaje ' + v.estado}>{etiqueta}</span>
                </div>
                <div className="viaje-ruta">
                  {v.origen}{v.destino ? ' → ' + v.destino : ''}
                </div>
                <div className="viaje-abajo">
                  <span>{v.tipo === 'programado' ? '📅 Programado' : '⚡ Inmediato'} · #{v.id}</span>
                  <span>
                    {v.chofer ? (fijo ? '📌 ' : '') + v.chofer.nombre
                      : v.espera_gestion && v.rechazo ? `❌ Lo rechazó ${v.rechazo.nombre}`
                      : urgente ? '⚠️ Falta chofer' : ''}
                  </span>
                </div>
                {v.cliente_nombre && <div className="viaje-cliente">{v.cliente_nombre}</div>}
              </button>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
