import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { fechaCorta, fechaLocal, hora } from './viajes.js'

const CADA_CUANTO = 30 * 1000

// App del chofer: viajes que esperan chofer, solo con el horario (para saber si hace falta gente).
export default function ViajesEsperando() {
  const [viajes, setViajes] = useState(null)

  useEffect(() => {
    const cargar = () => supabase.rpc('viajes_esperando').then(({ data }) => setViajes(data ?? []))
    cargar()
    const intervalo = setInterval(cargar, CADA_CUANTO)
    const alVolver = () => { if (document.visibilityState === 'visible') cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(intervalo); document.removeEventListener('visibilitychange', alVolver) }
  }, [])

  if (viajes === null) return null
  const hoy = fechaLocal()

  return (
    <section className="tarjeta separada">
      <h2>Viajes esperando chofer ({viajes.length})</h2>
      {viajes.length === 0 && <p className="ayuda sin-margen">No hay viajes esperando.</p>}
      <ul className="esperando">
        {viajes.map((v) => {
          const programado = v.tipo === 'programado'
          const horaViaje = programado ? v.hora_presentacion : v.hora_asignacion
          return (
            <li key={v.id}>
              <strong>{hora(horaViaje)}</strong>
              {fechaLocal(horaViaje) !== hoy && <small> {fechaCorta(horaViaje)}</small>}
              <span>{programado ? '📅 Programado' : '⚡ Para ya'}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
