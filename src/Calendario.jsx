import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'
import TarjetaViaje, { CONSULTA_VIAJES } from './TarjetaViaje.jsx'
import { esAsignableSinChofer, fechaLocal } from './viajes.js'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre',
  'Octubre', 'Noviembre', 'Diciembre']
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const NOMBRE_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// Día en que se hace el viaje (el de presentación si es programado).
const diaDelViaje = (v) => fechaLocal(v.hora_presentacion ?? v.hora_asignacion)

// Las 6 semanas que muestra la grilla del mes (empieza en lunes).
function diasDeLaGrilla(mes) {
  const primero = new Date(mes.getFullYear(), mes.getMonth(), 1)
  const corrimiento = (primero.getDay() + 6) % 7 // lunes = 0
  return Array.from({ length: 42 }, (_, i) => new Date(mes.getFullYear(), mes.getMonth(), 1 - corrimiento + i))
}

// Gestión: calendario del mes con los viajes de cada día. Al tocar un día se ven sus viajes.
export default function Calendario({ ahora, onAbrir }) {
  const [mes, setMes] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [elegido, setElegido] = useState(fechaLocal())
  const [viajes, setViajes] = useState(null)
  const [error, setError] = useState('')
  const dias = useMemo(() => diasDeLaGrilla(mes), [mes])

  const cargar = useCallback(async () => {
    // Un día de margen a cada lado (un programado de las 0:15 se asigna el día anterior).
    const desde = new Date(dias[0].getFullYear(), dias[0].getMonth(), dias[0].getDate() - 1)
    const hasta = new Date(dias[41].getFullYear(), dias[41].getMonth(), dias[41].getDate() + 2)
    const { data, error } = await supabase.from('viajes').select(CONSULTA_VIAJES)
      .gte('hora_asignacion', desde.toISOString()).lt('hora_asignacion', hasta.toISOString())
      .order('hora_asignacion').limit(2000)
    setError(error ? error.message : '')
    setViajes(data ?? [])
  }, [dias])

  useEffect(() => {
    cargar()
    const canal = supabase.channel('gestion-calendario')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'viajes' }, cargar)
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [cargar])

  const porDia = useMemo(() => {
    const grupos = {}
    for (const v of viajes ?? []) (grupos[diaDelViaje(v)] ??= []).push(v)
    return grupos
  }, [viajes])

  function cambiarMes(cuanto) {
    const nuevo = new Date(mes.getFullYear(), mes.getMonth() + cuanto, 1)
    setMes(nuevo)
    setElegido(fechaLocal(nuevo.getMonth() === new Date().getMonth() && nuevo.getFullYear() === new Date().getFullYear()
      ? new Date() : nuevo))
  }

  const hoy = fechaLocal()
  const delDia = (porDia[elegido] ?? []).slice()
    .sort((a, b) => new Date(a.hora_presentacion ?? a.hora_asignacion) - new Date(b.hora_presentacion ?? b.hora_asignacion))
  const fechaElegida = new Date(elegido + 'T12:00')

  return (
    <>
      <div className="calendario-arriba">
        <button type="button" className="boton-chico gris" onClick={() => cambiarMes(-1)} aria-label="Mes anterior">◀</button>
        <strong>{MESES[mes.getMonth()]} {mes.getFullYear()}</strong>
        <button type="button" className="boton-chico gris" onClick={() => cambiarMes(1)} aria-label="Mes siguiente">▶</button>
      </div>
      {error && <p className="aviso error">No se pudieron cargar los viajes: {error}</p>}

      <div className="calendario">
        {DIAS.map((d) => <span key={d} className="calendario-dia-semana">{d}</span>)}
        {dias.map((d) => {
          const clave = fechaLocal(d)
          const lista = (porDia[clave] ?? []).filter((v) => v.estado !== 'anulado')
          const faltaChofer = lista.some((v) => esAsignableSinChofer(v, ahora) && !v.chofer_fijo)
          return (
            <button key={clave} type="button"
              className={'calendario-dia' + (d.getMonth() !== mes.getMonth() ? ' otro-mes' : '')
                + (clave === hoy ? ' hoy' : '') + (clave === elegido ? ' elegido' : '')}
              onClick={() => setElegido(clave)}>
              <span>{d.getDate()}</span>
              {lista.length > 0 && <small className={faltaChofer ? 'cantidad urgente' : 'cantidad'}>{lista.length}</small>}
            </button>
          )
        })}
      </div>

      <h2 className="titulo-seccion">
        {elegido === hoy ? 'Hoy' : `${NOMBRE_DIA[fechaElegida.getDay()]} ${fechaElegida.getDate()}/${fechaElegida.getMonth() + 1}`}
      </h2>
      {viajes === null && <p>Cargando…</p>}
      {viajes !== null && delDia.length === 0 && <p className="ayuda">No hay viajes este día.</p>}
      <ul className="lista">
        {delDia.map((v) => (
          <li key={v.id}><TarjetaViaje v={v} ahora={ahora} onAbrir={() => onAbrir(v)} /></li>
        ))}
      </ul>
    </>
  )
}
