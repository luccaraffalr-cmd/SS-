import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// Configuración general (una sola fila), actualizada en tiempo real.
export function useConfiguracion() {
  const [config, setConfig] = useState({ minutos_sin_senal: 5 })

  useEffect(() => {
    supabase.from('configuracion').select('*').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data) setConfig(data) })
    const canal = supabase.channel('configuracion')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'configuracion' }, (c) => setConfig(c.new))
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [])

  return config
}

// Estados con alerta "sin señal" si deja de reportar. "En cola" no tiene alerta
// (decisión del dueño: el que se anunció queda fijo aunque bloquee el celular).
const TRABAJANDO = ['yendo', 'en_viaje']

export function estaSinSenal(chofer, minutos, ahora = Date.now()) {
  if (!TRABAJANDO.includes(chofer.estado)) return false
  // Si gestión le cambió el estado hace poco, se cuenta desde ese momento.
  const ultimo = Math.max(new Date(chofer.ultimo_reporte ?? 0).getTime(), new Date(chofer.estado_desde).getTime())
  return ahora - ultimo > minutos * 60 * 1000
}
