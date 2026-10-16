import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import TarjetaViaje, { CONSULTA_VIAJES } from './TarjetaViaje.jsx'
import { DIAS_GRILLA, MESES, deFechaLocal, diasDeLaGrilla, fechaCorta, fechaLocal, hora, problemaDelViaje } from './viajes.js'
const NOMBRE_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const RENGLONES_POR_DIA = 2 // en el celular cada día mide ~45 px: cada viaje va en dos líneas (hora y origen)

// Cuándo se hace el viaje (la presentación si es programado) y en qué día cae.
const momentoDelViaje = (v) => new Date(v.hora_presentacion ?? v.hora_asignacion)
const diaDelViaje = (v) => fechaLocal(momentoDelViaje(v))

// Gestión: calendario del mes, como el de Samsung (decidido el 14/10/2026): cada día muestra sus viajes (hora y origen),
// se pasa de mes deslizando con el dedo, y al tocar un día se ven sus viajes y se puede cargar uno nuevo para ese día.
// El día elegido lo guarda Viajes (elegido / onElegir), así al volver de un viaje sigue en el mismo mes.
export default function Calendario({ ahora, onAbrir, onNuevo, elegido, onElegir: setElegido }) {
  const [mes, setMes] = useState(() => {
    const d = deFechaLocal(elegido)
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [viajes, setViajes] = useState(null)
  const [error, setError] = useState('')
  const [entrada, setEntrada] = useState('') // de qué lado entra el mes nuevo (animación)
  const toque = useRef(null)
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

  // Al cambiar de mes solo se vuelve a cargar; el canal en vivo se abre una sola vez (si se cierra y se vuelve a abrir con
  // el mismo nombre mientras el anterior se está cerrando, Supabase da error).
  const cargarActual = useRef(cargar)
  useEffect(() => {
    cargarActual.current = cargar
    cargar()
  }, [cargar])
  useEffect(() => {
    const canal = supabase.channel('gestion-calendario')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'viajes' }, () => cargarActual.current())
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [])

  // Viajes de cada día, ordenados por hora.
  const porDia = useMemo(() => {
    const grupos = {}
    for (const v of viajes ?? []) (grupos[diaDelViaje(v)] ??= []).push(v)
    for (const lista of Object.values(grupos)) lista.sort((a, b) => momentoDelViaje(a) - momentoDelViaje(b))
    return grupos
  }, [viajes])

  function cambiarMes(cuanto) {
    const nuevo = new Date(mes.getFullYear(), mes.getMonth() + cuanto, 1)
    setEntrada(cuanto > 0 ? 'desde-derecha' : 'desde-izquierda')
    setMes(nuevo)
    setElegido(fechaLocal(nuevo.getMonth() === new Date().getMonth() && nuevo.getFullYear() === new Date().getFullYear()
      ? new Date() : nuevo))
  }

  // Deslizar con el dedo: a la izquierda, mes siguiente; a la derecha, mes anterior.
  function empezarToque(e) {
    const t = e.touches[0]
    toque.current = { x: t.clientX, y: t.clientY }
  }
  function terminarToque(e) {
    if (!toque.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - toque.current.x, dy = t.clientY - toque.current.y
    toque.current = null
    if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) cambiarMes(dx < 0 ? 1 : -1)
  }

  const hoy = fechaLocal()
  const delDia = porDia[elegido] ?? []
  const fechaElegida = deFechaLocal(elegido)

  return (
    <>
      <div className="calendario-arriba">
        <button type="button" className="boton-chico gris" onClick={() => cambiarMes(-1)} aria-label="Mes anterior">◀</button>
        <strong>{MESES[mes.getMonth()]} {mes.getFullYear()}</strong>
        <button type="button" className="boton-chico gris" onClick={() => cambiarMes(1)} aria-label="Mes siguiente">▶</button>
      </div>
      {error && <p className="aviso error">No se pudieron cargar los viajes: {error}</p>}

      <div className="calendario">
        {DIAS_GRILLA.map((d) => <span key={d} className="calendario-dia-semana">{d}</span>)}
      </div>
      <div className="calendario-marco">
        <div key={mes.getTime()} className={'calendario calendario-mes ' + entrada}
          onTouchStart={empezarToque} onTouchEnd={terminarToque}>
          {dias.map((d) => {
            const clave = fechaLocal(d)
            const lista = (porDia[clave] ?? []).filter((v) => v.estado !== 'anulado')
            return (
              <button key={clave} type="button"
                className={'calendario-dia' + (d.getMonth() !== mes.getMonth() ? ' otro-mes' : '')
                  + (clave === hoy ? ' hoy' : '') + (clave === elegido ? ' elegido' : '')}
                onClick={() => setElegido(clave)}>
                <span className="numero">{d.getDate()}</span>
                {lista.slice(0, RENGLONES_POR_DIA).map((v) => (
                  // En rojo si el viaje necesita atención (sin chofer, sin aceptar o el chofer no salió).
                  <small key={v.id} className={'renglon' + (problemaDelViaje(v, ahora) ? ' urgente' : '')}>
                    <b>{hora(momentoDelViaje(v)).replace(/^0/, '')}</b>
                    <span>{v.origen}</span>
                  </small>
                ))}
                {lista.length > RENGLONES_POR_DIA && <small className="mas">+{lista.length - RENGLONES_POR_DIA}</small>}
              </button>
            )
          })}
        </div>
      </div>

      <h2 className="titulo-seccion">
        {elegido === hoy ? 'Hoy' : `${NOMBRE_DIA[fechaElegida.getDay()]} ${fechaElegida.getDate()}/${fechaElegida.getMonth() + 1}`}
      </h2>
      {onNuevo && elegido >= hoy && (
        <button type="button" className="boton secundario sin-margen-arriba" onClick={() => onNuevo(elegido)}>
          + Nuevo viaje para {elegido === hoy ? 'hoy' : `el ${fechaCorta(fechaElegida)}`}
        </button>
      )}
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
