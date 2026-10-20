import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

const CADA_CUANTO = 20 * 1000

// Chofer: "📣 Salió un viaje para Juan" (decidido el 20/10/2026, pedido del dueño). Viajes de la cola ofrecidos a otro
// chofer que todavía no los aceptó, para poder avisarle si no los ve. Con el cliente (no el recorrido).
// También les llega un aviso al celular (función "notificar").
export default function OfertasEnCurso({ yo }) {
  const [ofertas, setOfertas] = useState([])
  const [ahora, setAhora] = useState(Date.now())

  useEffect(() => {
    const cargar = () => supabase.rpc('ofertas_en_curso').then(({ data }) => { setOfertas(data ?? []); setAhora(Date.now()) })
    cargar()
    const intervalo = setInterval(cargar, CADA_CUANTO)
    const alVolver = () => { if (document.visibilityState === 'visible') cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(intervalo); document.removeEventListener('visibilitychange', alVolver) }
  }, [])

  const deOtros = ofertas.filter((o) => o.chofer_id !== yo)
  if (deOtros.length === 0) return null

  return (
    <section className="tarjeta separada salio-viaje">
      {deOtros.map((o) => {
        const minutos = Math.max(0, Math.floor((ahora - new Date(o.desde)) / 60000))
        return (
          <div key={o.viaje_id} className="dato">
            <strong>📣 Salió un viaje para {o.chofer}</strong>
            <small>{minutos === 0 ? 'Recién' : `Hace ${minutos} min`}{o.cliente && ` · Cliente: ${o.cliente}`}</small>
          </div>
        )
      })}
      <small className="ayuda sin-margen">Si no lo ve, avisale.</small>
    </section>
  )
}
