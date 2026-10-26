import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { useAtras } from './atras.js'
import FormViaje from './FormViaje.jsx'
import TarjetaViaje, { CONSULTA_VIAJES, paraAprobar } from './TarjetaViaje.jsx'
import Calendario from './Calendario.jsx'
import ViajesFijos from './ViajesFijos.jsx'
import { NOMBRE_ESTADO_VIAJE, fechaLocal, unirFechaHora } from './viajes.js'

// Orden de la lista (pedido del dueño, 26/10/2026): arriba los que se están haciendo, después los próximos (sin tomar o
// aceptados que todavía no salieron), los terminados (los que faltan aprobar) y los aprobados. (Los eliminados solo se
// ven con su filtro.)
function grupoDelViaje(v) {
  if (v.estado === 'asignado' && v.iniciado_en) return 0 // en viaje
  if (['sin_chofer', 'ofrecido', 'asignado'].includes(v.estado)) return 1 // próximos
  if (v.estado === 'finalizado' && v.aprobado_en) return 3 // pago aprobado
  if (v.estado === 'anulado') return 4
  return 2 // hechos: pago pendiente, finalizado sin aprobar, fallido
}

// Filtro que no es un estado del viaje: los finalizados con el pago aprobado (24/10/2026). Los que faltan aprobar están en
// "Finalizado", con el tick.
const FILTROS_APROBACION = { aprobado: 'Aprobado' }

// Opciones del filtro de estado: "Aprobado" después de "Finalizado" y "Eliminado" al final de todo.
const OPCIONES_ESTADO = [
  ...Object.entries(NOMBRE_ESTADO_VIAJE).filter(([id]) => id !== 'anulado')
    .flatMap((opcion) => (opcion[0] === 'finalizado' ? [opcion, ...Object.entries(FILTROS_APROBACION)] : [opcion])),
  ['anulado', NOMBRE_ESTADO_VIAJE.anulado],
]

// Gestión: todos los viajes con su estado, con filtros por fecha, estado y chofer. Los admins aprueban los pagos: tickean
// los viajes finalizados y confirman con la burbuja verde de abajo.
export default function Viajes({ esAdmin }) {
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
  const [elegidos, setElegidos] = useState([]) // viajes tickeados para aprobar el pago
  const [paraAprobarTotal, setParaAprobarTotal] = useState(0) // de todas las fechas
  const [aprobando, setAprobando] = useState(false)
  const [errorAprobar, setErrorAprobar] = useState('')

  const cargar = useCallback(async () => {
    supabase.from('viajes').select('id', { count: 'exact', head: true }).eq('estado', 'pago_pendiente')
      .then(({ count }) => setPagosPendientes(count ?? 0))
    supabase.from('viajes').select('id', { count: 'exact', head: true }).eq('estado', 'finalizado').is('aprobado_en', null)
      .then(({ count }) => setParaAprobarTotal(count ?? 0))
    supabase.from('planilla_envios').select('viaje_id').eq('pendiente', true).not('error', 'is', null).order('viaje_id')
      .then(({ data }) => setSinPlanilla((data ?? []).map((e) => e.viaje_id)))

    let consulta = supabase.from('viajes').select(CONSULTA_VIAJES)
    if (filtroFecha) {
      const desde = unirFechaHora(filtroFecha, '00:00')
      const hasta = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate() + 1)
      consulta = consulta.gte('hora_asignacion', desde.toISOString()).lt('hora_asignacion', hasta.toISOString())
    }
    // Los eliminados (anulados) no se ven en ningún lado, salvo con el filtro "Eliminado" (24/10/2026).
    if (filtroEstado !== 'anulado') consulta = consulta.neq('estado', 'anulado')
    if (filtroEstado === 'aprobado') consulta = consulta.eq('estado', 'finalizado').not('aprobado_en', 'is', null)
    else if (filtroEstado) consulta = consulta.eq('estado', filtroEstado)
    if (filtroChofer === 'ninguno') consulta = consulta.is('chofer_id', null)
    else if (filtroChofer) consulta = consulta.eq('chofer_id', filtroChofer)

    const { data, error } = await consulta.limit(500)
    setErrorCarga(error ? error.message : '')
    // Por grupo; dentro de cada grupo, los que faltan del más próximo al más lejano y los terminados, el más reciente arriba.
    setViajes((data ?? []).sort((a, b) => {
      const grupoA = grupoDelViaje(a), grupoB = grupoDelViaje(b)
      if (grupoA !== grupoB) return grupoA - grupoB
      const dif = new Date(a.hora_asignacion) - new Date(b.hora_asignacion)
      return grupoA <= 1 ? dif : -dif
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

  // El botón atrás del celular hace lo mismo que "Volver" (y con viajes tickeados, los destickea).
  useAtras(!!editando, () => { setEditando(null); cargar() })
  useAtras(vista === 'fijos', () => setVista('lista'))
  useAtras(elegidos.length > 0 && !editando, () => setElegidos([]))

  const alternarElegido = (id) => {
    setErrorAprobar('')
    setElegidos((lista) => (lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]))
  }

  async function aprobarElegidos() {
    setErrorAprobar('')
    setAprobando(true)
    const { error } = await supabase.rpc('aprobar_pagos', { p_viajes: elegidos })
    setAprobando(false)
    if (error) return setErrorAprobar('No se pudieron aprobar: ' + error.message)
    setElegidos([])
    cargar()
  }

  if (editando) {
    return <FormViaje viaje={editando === 'nuevo' ? null : editando} fechaInicial={editando === 'nuevo' ? fechaNueva : null}
      esAdmin={esAdmin}
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
    <main className={'pantalla' + (elegidos.length > 0 ? ' con-burbuja' : '')}>
      <h1>Viajes</h1>
      {selectorVista}
      {errorAprobar && <p className="aviso error">{errorAprobar}</p>}
      {esAdmin && paraAprobarTotal > 0 && !(filtroEstado === 'finalizado' && !filtroFecha) && (
        <button className="aviso-pagos aviso-aprobar"
          onClick={() => { setFiltroFecha(''); setFiltroEstado('finalizado'); setFiltroChofer('') }}>
          ✓ {paraAprobarTotal} {paraAprobarTotal === 1 ? 'pago' : 'pagos'} para aprobar — tocá para verlos
        </button>
      )}
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
            {OPCIONES_ESTADO.map(([id, texto]) => <option key={id} value={id}>{texto}</option>)}
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
            <TarjetaViaje v={v} ahora={ahora} mostrarFecha={!filtroFecha} onAbrir={() => setEditando(v)}
              onTickear={esAdmin && paraAprobar(v) ? () => alternarElegido(v.id) : undefined}
              elegido={elegidos.includes(v.id)} />
          </li>
        ))}
      </ul>

      {elegidos.length > 0 && (
        <div className="burbuja-aprobar">
          <button className="boton" disabled={aprobando} onClick={aprobarElegidos}>
            {aprobando ? 'Aprobando…' : `✅ Aprobar ${elegidos.length === 1 ? 'el pago' : `${elegidos.length} pagos`}`}
          </button>
          <button className="cancelar-burbuja" onClick={() => setElegidos([])}>Cancelar</button>
        </div>
      )}
    </main>
  )
}
