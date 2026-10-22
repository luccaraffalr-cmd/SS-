import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { textoError } from './estados.js'
import { fechaCorta, fechaLocal, hora } from './viajes.js'

const CADA_CUANTO = 30 * 1000

// Viajes sin chofer, para los choferes (sin datos del cliente). Se actualiza cada 30 segundos.
function useViajesEsperando() {
  const [viajes, setViajes] = useState(null)
  const cargar = useCallback(() => supabase.rpc('viajes_esperando').then(({ data }) => setViajes(data ?? [])), [])
  useEffect(() => {
    cargar()
    const intervalo = setInterval(cargar, CADA_CUANTO)
    const alVolver = () => { if (document.visibilityState === 'visible') cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(intervalo); document.removeEventListener('visibilitychange', alVolver) }
  }, [cargar])
  return [viajes, cargar]
}

// Cartel rojo: viajes que ya se tendrían que estar haciendo y no tienen chofer.
// Al tocarlo muestra cuáles son (hora, origen y destino). Desde el 22/10/2026, si en un minuto nadie de la cola lo toma,
// el chofer lo puede tomar ("✋ Tomar este viaje"): el primero que lo toma se lo queda.
export function AlertaSinChoferChofer({ chofer }) {
  const [viajes, recargar] = useViajesEsperando()
  const [abierto, setAbierto] = useState(false)
  const [, setTic] = useState(0)
  const ahora = Date.now()
  const sinChofer = (viajes ?? []).filter((v) => v.estado === 'sin_chofer')
  const urgentes = sinChofer.filter((v) => new Date(v.hora_asignacion).getTime() <= ahora)
  const sePuedeTomar = (v) => !!v.tomar_desde && new Date(v.tomar_desde).getTime() <= ahora
  const hayParaTomar = urgentes.some(sePuedeTomar) && !chofer.oculto

  // Mientras haya viajes sin chofer, se redibuja cada segundo: así aparecen a su hora y el botón se habilita al minuto.
  useEffect(() => {
    if (sinChofer.length === 0) return
    const reloj = setInterval(() => setTic((t) => t + 1), 1000)
    return () => clearInterval(reloj)
  }, [sinChofer.length])

  if (urgentes.length === 0) return null

  return (
    <div className="alerta-chofer">
      <button className="alerta-sin-chofer" onClick={() => setAbierto(!abierto)}>
        <strong>⚠️ {urgentes.length} {urgentes.length === 1 ? 'viaje' : 'viajes'} sin chofer</strong>
        <span className="detalle">
          {abierto ? 'Tocá para cerrar' : hayParaTomar ? '✋ Lo podés tomar: tocá para verlo' : 'Tocá para ver cuáles son'}
        </span>
      </button>
      {abierto && (
        <ul className="lista-alerta">
          {urgentes.map((v) => (
            <li key={v.id}>
              {/* El chofer no ve datos del cliente: lo más grande es el origen y el horario va abajo. */}
              <strong>{v.origen}</strong>
              {v.destino && <span>→ {v.destino}</span>}
              <span className="viaje-cuando">
                {v.tipo === 'programado' ? `Presentarse ${hora(v.hora_presentacion)}` : `Para ya (desde ${hora(v.hora_asignacion)})`}
              </span>
              <TomarViaje viaje={v} chofer={chofer} ahora={ahora} onTomado={recargar} />
            </li>
          ))}
          <li className="ayuda">
            Si podés hacerlo, anunciate: se le ofrece al primero que se anuncia. Si en un minuto nadie lo toma, lo podés
            tomar acá.
          </li>
        </ul>
      )}
    </div>
  )
}

// Botón para tomar un viaje sin chofer (con confirmación, para no tomarlo sin querer).
function TomarViaje({ viaje, chofer, ahora, onTomado }) {
  const [confirmando, setConfirmando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  if (!viaje.tomar_desde || chofer.oculto) return null

  const faltan = Math.ceil((new Date(viaje.tomar_desde).getTime() - ahora) / 1000)
  if (faltan > 0) return <small>Si nadie se anuncia, en {faltan} s lo vas a poder tomar.</small>
  if (chofer.estado === 'fuera_de_servicio') return <small>Para tomarlo, tocá "Empezar a trabajar".</small>

  async function tomar() {
    setError('')
    setOcupado(true)
    const { error } = await supabase.rpc('tomar_viaje', { viaje: viaje.id })
    setOcupado(false)
    setConfirmando(false)
    if (error) setError(textoError(error))
    onTomado()
  }

  if (!confirmando) {
    return (
      <>
        <button type="button" className="boton verde tomar-viaje" onClick={() => setConfirmando(true)}>✋ Tomar este viaje</button>
        {error && <p className="aviso error sin-margen">{error}</p>}
      </>
    )
  }
  return (
    <div className="botonera tomar-viaje">
      <p className="sin-margen">
        <strong>¿Lo tomás?</strong>{' '}
        {chofer.estado === 'en_viaje' ? 'Te queda como próximo viaje.' : 'Salís a hacerlo ahora.'}
      </p>
      <div className="dos-columnas">
        <button type="button" className="boton secundario" onClick={() => setConfirmando(false)}>No</button>
        <button type="button" className="boton verde" disabled={ocupado} onClick={tomar}>Sí, lo tomo</button>
      </div>
    </div>
  )
}

// "Próximos viajes": programados sin chofer que todavía no llegaron a su hora de asignación.
export default function ProximosViajes() {
  const [viajes] = useViajesEsperando()
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
