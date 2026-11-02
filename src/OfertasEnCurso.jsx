import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { haceCuanto } from './estados.js'

const CADA_CUANTO = 20 * 1000

// Chofer: "📣 Salió un viaje para Juan" (decidido el 20/10/2026, pedido del dueño). Viajes de la cola ofrecidos a otro
// chofer que todavía no los aceptó, para poder avisarle si no los ve. Sin el cliente ni el recorrido: ningún chofer
// puede saber quién hizo un viaje (27/10/2026). También les llega un aviso al celular (función "notificar").
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
        const hace = haceCuanto(o.desde, ahora)
        return (
          <div key={o.chofer_id + o.desde} className="dato">
            <strong>📣 Salió un viaje para {o.chofer}</strong>
            <small>{hace[0].toUpperCase() + hace.slice(1)}</small>
          </div>
        )
      })}
      <small className="ayuda sin-margen">Si no lo ve, avisale.</small>
    </section>
  )
}
