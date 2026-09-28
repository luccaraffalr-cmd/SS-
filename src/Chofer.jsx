import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { urlFotoAuto } from './fotos.js'
import { NOMBRE_ESTADO, textoError } from './estados.js'

const CADA_CUANTO_REPORTA = 60 * 1000 // 1 minuto

// App del chofer: estado (conectado / yendo / desconectado) y su auto.
export default function Chofer({ perfil }) {
  const [chofer, setChofer] = useState(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const estadoRef = useRef(null)
  estadoRef.current = chofer?.estado

  // Al abrir la app y cada minuto: "sigo acá". Si tocó "Desconectarme", no reporta
  // (si no, lo volvería a conectar solo).
  useEffect(() => {
    async function reportar() {
      if (estadoRef.current === 'desconectado') return
      const { data, error } = await supabase.rpc('reportar_chofer')
      if (error || !data) setError('No se pudo conectar con el servidor. Revisá tu internet.')
      else { setError(''); setChofer(data) }
    }
    reportar()
    const intervalo = setInterval(reportar, CADA_CUANTO_REPORTA)
    const alVolver = () => { if (document.visibilityState === 'visible') reportar() }
    document.addEventListener('visibilitychange', alVolver)

    // Si gestión le cambia el estado, se entera al instante.
    const canal = supabase.channel('mi-estado')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'choferes', filter: `id=eq.${perfil.id}` },
        (cambio) => setChofer(cambio.new))
      .subscribe()

    return () => {
      clearInterval(intervalo)
      document.removeEventListener('visibilitychange', alVolver)
      supabase.removeChannel(canal)
    }
  }, [perfil.id])

  async function cambiarEstado(nuevo) {
    setError('')
    setOcupado(true)
    const { data, error } = await supabase.rpc('cambiar_mi_estado', { nuevo })
    setOcupado(false)
    if (error) setError(textoError(error))
    else setChofer(data)
  }

  async function cerrarSesion() {
    if (chofer?.estado === 'en_viaje') {
      setError('Tenés un viaje sin finalizar. Primero finalizalo.')
      return
    }
    await supabase.rpc('cambiar_mi_estado', { nuevo: 'desconectado' })
    await supabase.auth.signOut()
  }

  if (!chofer) {
    return (
      <main className="pantalla">
        {error ? <p className="aviso error">{error}</p> : <p>Cargando…</p>}
        <button className="boton secundario" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
      </main>
    )
  }

  const estado = chofer.estado

  return (
    <main className="pantalla">
      <h1>Hola, {perfil.nombre}</h1>

      <div className={'estado-grande ' + estado}>
        {NOMBRE_ESTADO[estado]}
      </div>
      {estado === 'conectado' && <p className="ayuda centrada">Tenés la app abierta, pero todavía no estás trabajando.</p>}
      {estado === 'yendo' && <p className="ayuda centrada">Avisaste que vas para la base.</p>}
      {estado === 'desconectado' && <p className="ayuda centrada">No estás trabajando.</p>}

      <div className="botonera">
        {estado === 'conectado' && (
          <button className="boton grande" disabled={ocupado} onClick={() => cambiarEstado('yendo')}>🚗 Yendo a la base</button>
        )}
        {estado === 'yendo' && (
          <button className="boton secundario" disabled={ocupado} onClick={() => cambiarEstado('conectado')}>Ya no voy</button>
        )}
        {estado === 'desconectado' && (
          <button className="boton grande" disabled={ocupado} onClick={() => cambiarEstado('conectado')}>Conectarme</button>
        )}
        {(estado === 'conectado' || estado === 'yendo') && (
          <button className="boton secundario" disabled={ocupado} onClick={() => cambiarEstado('desconectado')}>Desconectarme</button>
        )}
      </div>
      {error && <p className="aviso error">{error}</p>}

      <div className="tarjeta separada">
        {chofer.foto_auto && (
          <div className="foto-auto"><img src={urlFotoAuto(chofer.foto_auto)} alt="Tu auto" /></div>
        )}
        <p className="sin-margen">
          <strong>{[chofer.auto_modelo, chofer.auto_color].filter(Boolean).join(' · ') || 'Auto sin cargar'}</strong>
          {chofer.patente && <><br />Patente: {chofer.patente}</>}
        </p>
      </div>

      <button className="boton secundario" onClick={cerrarSesion}>Cerrar sesión</button>
    </main>
  )
}
