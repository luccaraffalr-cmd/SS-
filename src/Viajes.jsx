import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import FormViaje from './FormViaje.jsx'
import TarjetaViaje, { CONSULTA_VIAJES } from './TarjetaViaje.jsx'
import Calendario from './Calendario.jsx'
import ViajesFijos from './ViajesFijos.jsx'
import { NOMBRE_ESTADO_VIAJE, fechaLocal, unirFechaHora } from './viajes.js'

const ACTIVOS = ['sin_chofer', 'ofrecido', 'asignado']

// Gestión: todos los viajes con su estado, con filtros por fecha, estado y chofer.
export default function Viajes() {
  const [viajes, setViajes] = useState(null)
  const [choferes, setChoferes] = useState([])
  const [editando, setEditando] = useState(null) // null = lista; 'nuevo' = alta; objeto = edición
  const [vista, setVista] = useState('lista') // 'lista' | 'calendario' | 'fijos'
  const [filtroFecha, setFiltroFecha] = useState(fechaLocal())
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroChofer, setFiltroChofer] = useState('')
  const [ahora, setAhora] = useState(Date.now())
  const [errorCarga, setErrorCarga] = useState('')
  const [pagosPendientes, setPagosPendientes] = useState(0) // de todas las fechas
  const [sinPlanilla, setSinPlanilla] = useState([]) // n.º de los viajes que no se pudieron pasar a la planilla
  const [diaCalendario, setDiaCalendario] = useState(fechaLocal()) // día elegido en el calendario (se recuerda al volver)
  const [fechaNueva, setFechaNueva] = useState(null) // viaje nuevo cargado desde un día del calendario

  const cargar = useCallback(async () => {
    supabase.from('viajes').select('id', { count: 'exact', head: true }).eq('estado', 'pago_pendiente')
      .then(({ count }) => setPagosPendientes(count ?? 0))
    supabase.from('planilla_envios').select('viaje_id').eq('pendiente', true).not('error', 'is', null).order('viaje_id')
      .then(({ data }) => setSinPlanilla((data ?? []).map((e) => e.viaje_id)))

    let consulta = supabase.from('viajes').select(CONSULTA_VIAJES)
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
    // (El pedido recién sale al esperar la respuesta: por eso el .then.)
    const revisar = setInterval(() => supabase.rpc('revisar_asignaciones').then(() => {}), 20 * 1000)
    return () => { clearInterval(reloj); clearInterval(revisar) }
  }, [])

  async function abrirViaje(id) {
    const { data } = await supabase.from('viajes').select(CONSULTA_VIAJES).eq('id', id).single()
    if (data) setEditando(data)
  }

  if (editando) {
    return <FormViaje viaje={editando === 'nuevo' ? null : editando} fechaInicial={editando === 'nuevo' ? fechaNueva : null}
      onListo={() => { setEditando(null); cargar() }} />
  }
  if (vista === 'fijos') return <ViajesFijos onVolver={() => setVista('lista')} />

  const selectorVista = (
    <div className="selector-tipo selector-vista">
      <button type="button" className={vista === 'lista' ? 'activo' : ''} onClick={() => setVista('lista')}>📋 Lista</button>
      <button type="button" className={vista === 'calendario' ? 'activo' : ''} onClick={() => setVista('calendario')}>📅 Calendario</button>
    </div>
  )
  const botones = (
    <div className="dos-columnas">
      <button className="boton" onClick={() => { setFechaNueva(null); setEditando('nuevo') }}>+ Nuevo viaje</button>
      <button className="boton secundario sin-margen-arriba" onClick={() => setVista('fijos')}>🔁 Viajes fijos</button>
    </div>
  )

  if (vista === 'calendario') {
    return (
      <main className="pantalla">
        <h1>Viajes</h1>
        {selectorVista}
        {botones}
        <Calendario ahora={ahora} onAbrir={setEditando} elegido={diaCalendario} onElegir={setDiaCalendario}
          onNuevo={(fecha) => { setFechaNueva(fecha); setEditando('nuevo') }} />
      </main>
    )
  }

  return (
    <main className="pantalla">
      <h1>Viajes</h1>
      {selectorVista}
      {pagosPendientes > 0 && (
        <button className="aviso-pagos" onClick={() => { setFiltroFecha(''); setFiltroEstado('pago_pendiente'); setFiltroChofer('') }}>
          ⏳ {pagosPendientes} {pagosPendientes === 1 ? 'viaje' : 'viajes'} con pago pendiente — tocá para verlos
        </button>
      )}
      {sinPlanilla.length > 0 && (
        <button className="aviso-pagos aviso-planilla" onClick={() => abrirViaje(sinPlanilla[0])}>
          ⚠️ {sinPlanilla.length === 1 ? 'El viaje' : `${sinPlanilla.length} viajes`} #{sinPlanilla.slice(0, 5).join(', #')}
          {sinPlanilla.length > 5 && '…'} no se {sinPlanilla.length === 1 ? 'pudo' : 'pudieron'} pasar a la planilla — tocá para ver
        </button>
      )}
      {botones}

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
        {viajes?.map((v) => (
          <li key={v.id}>
            <TarjetaViaje v={v} ahora={ahora} mostrarFecha={!filtroFecha} onAbrir={() => setEditando(v)} />
          </li>
        ))}
      </ul>
    </main>
  )
}
