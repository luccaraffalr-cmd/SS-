import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { hora } from './viajes.js'

// Cartel rojo arriba de todo el panel de gestión cuando hay viajes que ya se tendrían
// que estar haciendo y no tienen chofer. Primero los programados más cerca de su hora.
export default function AlertaSinChofer({ onVer }) {
  const [viajes, setViajes] = useState([])
  const [ahora, setAhora] = useState(Date.now())

  useEffect(() => {
    const cargar = () => supabase.from('viajes')
      .select('id, tipo, hora_presentacion, hora_asignacion, espera_gestion')
      .eq('estado', 'sin_chofer').lte('hora_asignacion', new Date().toISOString())
      .then(({ data }) => setViajes(data ?? []))
    cargar()
    const canal = supabase.channel('alerta-sin-chofer')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'viajes' }, cargar)
      .subscribe()
    // Cada 30 segundos: los programados que llegan a su hora de asignación.
    const reloj = setInterval(() => { setAhora(Date.now()); cargar() }, 30 * 1000)
    return () => { supabase.removeChannel(canal); clearInterval(reloj) }
  }, [])

  if (viajes.length === 0) return null

  const minutosPara = (fecha) => Math.round((new Date(fecha).getTime() - ahora) / 60000)
  const ordenados = [...viajes].sort((a, b) =>
    new Date(a.hora_presentacion ?? a.hora_asignacion) - new Date(b.hora_presentacion ?? b.hora_asignacion))

  return (
    <button className="alerta-sin-chofer" onClick={onVer}>
      <strong>⚠️ {viajes.length} {viajes.length === 1 ? 'viaje' : 'viajes'} sin chofer</strong>
      <span className="detalle">
        {ordenados.slice(0, 3).map((v) => {
          if (v.tipo === 'programado') {
            const min = minutosPara(v.hora_presentacion)
            const texto = min > 0 ? `en ${min} min` : min === 0 ? 'ya' : `hace ${-min} min`
            return <span key={v.id}>📅 {hora(v.hora_presentacion)} ({texto}){v.espera_gestion && ' ❌'}</span>
          }
          return <span key={v.id}>⚡ desde {hora(v.hora_asignacion)}{v.espera_gestion && ' ❌'}</span>
        })}
        {viajes.length > 3 && <span>y {viajes.length - 3} más</span>}
      </span>
    </button>
  )
}
