import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { NOMBRE_ESTADO } from './estados.js'

const ORDEN_ESTADO = { en_cola: 0, libre: 1, en_viaje: 2, fuera_de_servicio: 3 }

// Lista de choferes activos con su estado, para elegir a quién asignar un viaje.
// Primero los de la cola (en orden), después libres, en viaje y fuera de servicio.
export function useChoferesParaAsignar() {
  const [choferes, setChoferes] = useState([])

  useEffect(() => {
    supabase.from('choferes').select('id, estado, anunciado_en, oculto, perfiles(nombre, activo)')
      .then(({ data }) => setChoferes((data ?? [])
        .filter((c) => c.perfiles?.activo)
        .sort((a, b) => (ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado])
          || (a.estado === 'en_cola' ? new Date(a.anunciado_en) - new Date(b.anunciado_en) : 0)
          || a.perfiles.nombre.localeCompare(b.perfiles.nombre))))
  }, [])

  return choferes
}

export function textoOpcionChofer(c) {
  const extra = c.estado === 'en_viaje' ? ' (queda como próximo viaje)' : ''
  return `${c.perfiles.nombre} — ${NOMBRE_ESTADO[c.estado]}${c.oculto ? ', oculto' : ''}${extra}`
}

// Selector de chofer. valor = id del chofer o '' (sin chofer).
export default function ElegirChofer({ valor, onCambiar, choferes, textoVacio = 'Sin chofer (asignación automática)' }) {
  return (
    <select value={valor} onChange={(e) => onCambiar(e.target.value)}>
      <option value="">{textoVacio}</option>
      {choferes.map((c) => <option key={c.id} value={c.id}>{textoOpcionChofer(c)}</option>)}
    </select>
  )
}
