import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { fechaCorta, hora } from './viajes.js'

// Registro de todo lo que pasó con un viaje: quién hizo qué y cuándo.
export default function HistorialViaje({ viajeId }) {
  const [filas, setFilas] = useState(null)

  useEffect(() => {
    supabase.from('registro').select('id, accion, hecho_en, quien:perfiles(nombre)')
      .eq('viaje_id', viajeId).order('hecho_en').order('id')
      .then(({ data }) => setFilas(data ?? []))
  }, [viajeId])

  if (!filas?.length) return null

  return (
    <div className="tarjeta separada">
      <h2>Historial</h2>
      <ul className="historial">
        {filas.map((f) => (
          <li key={f.id}>
            <span className="cuando">{fechaCorta(f.hecho_en)} {hora(f.hecho_en)}</span>
            <span>{f.accion}</span>
            <small>{f.quien?.nombre ?? 'Sistema'}</small>
          </li>
        ))}
      </ul>
    </div>
  )
}
