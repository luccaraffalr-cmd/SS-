import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { fechaCorta, fechaLocal, hora } from './viajes.js'

const CADA_CUANTO = 30 * 1000

// Viajes sin chofer, para los choferes (sin datos del cliente). Se actualiza cada 30 segundos.
function useViajesEsperando() {
  const [viajes, setViajes] = useState(null)
  useEffect(() => {
    const cargar = () => supabase.rpc('viajes_esperando').then(({ data }) => setViajes(data ?? []))
    cargar()
    const intervalo = setInterval(cargar, CADA_CUANTO)
    const alVolver = () => { if (document.visibilityState === 'visible') cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(intervalo); document.removeEventListener('visibilitychange', alVolver) }
  }, [])
  return viajes
}

// Cartel rojo: viajes que ya se tendrían que estar haciendo y no tienen chofer.
// Al tocarlo muestra cuáles son (hora, origen y destino).
export function AlertaSinChoferChofer() {
  const viajes = useViajesEsperando()
  const [abierto, setAbierto] = useState(false)
  const urgentes = (viajes ?? []).filter((v) => v.estado === 'sin_chofer' && new Date(v.hora_asignacion) <= new Date())
  if (urgentes.length === 0) return null

  return (
    <div className="alerta-chofer">
      <button className="alerta-sin-chofer" onClick={() => setAbierto(!abierto)}>
        <strong>⚠️ {urgentes.length} {urgentes.length === 1 ? 'viaje' : 'viajes'} sin chofer</strong>
        <span className="detalle">{abierto ? 'Tocá para cerrar' : 'Tocá para ver cuáles son'}</span>
      </button>
      {abierto && (
        <ul className="lista-alerta">
          {urgentes.map((v) => (
            <li key={v.id}>
              <strong>{v.tipo === 'programado' ? `Presentarse ${hora(v.hora_presentacion)}` : `Para ya (desde ${hora(v.hora_asignacion)})`}</strong>
              <span>{v.origen}{v.destino ? ' → ' + v.destino : ''}</span>
            </li>
          ))}
          <li className="ayuda">Si podés hacerlo, anunciate o avisale a gestión.</li>
        </ul>
      )}
    </div>
  )
}

// "Próximos viajes": programados sin chofer que todavía no llegaron a su hora de asignación.
export default function ProximosViajes() {
  const viajes = useViajesEsperando()
  if (viajes === null) return null
  const ahora = new Date()
  const proximos = viajes.filter((v) => new Date(v.hora_asignacion) > ahora)
  const hoy = fechaLocal()

  return (
    <section className="tarjeta separada">
      <h2>Próximos viajes ({proximos.length})</h2>
      {proximos.length === 0 && <p className="ayuda sin-margen">No hay próximos viajes sin chofer.</p>}
      <ul className="esperando">
        {proximos.map((v) => (
          <li key={v.id}>
            <strong>{hora(v.hora_asignacion)}</strong>
            {fechaLocal(v.hora_asignacion) !== hoy && <small> {fechaCorta(v.hora_asignacion)}</small>}
          </li>
        ))}
      </ul>
    </section>
  )
}
