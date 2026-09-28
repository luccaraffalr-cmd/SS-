import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { urlFotoAuto } from './fotos.js'
import { NOMBRE_ESTADO, textoError } from './estados.js'

const CADA_CUANTO_REPORTA = 60 * 1000 // 1 minuto

// App del chofer: su estado, la cola y quién está yendo o en viaje.
export default function Chofer({ perfil }) {
  const [chofer, setChofer] = useState(null)
  const [companeros, setCompaneros] = useState([])
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const estadoRef = useRef(null)
  estadoRef.current = chofer?.estado

  const cargarTablero = useCallback(async () => {
    const { data } = await supabase.from('choferes')
      .select('id, estado, anunciado_en, oculto, perfiles(nombre)')
      .in('estado', ['en_cola', 'yendo', 'en_viaje'])
    setCompaneros(data ?? [])
  }, [])

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
    cargarTablero()
    const intervalo = setInterval(reportar, CADA_CUANTO_REPORTA)
    const alVolver = () => { if (document.visibilityState === 'visible') { reportar(); cargarTablero() } }
    document.addEventListener('visibilitychange', alVolver)

    // Cualquier cambio en los choferes (el propio o los compañeros) llega al instante.
    const canal = supabase.channel('tablero-chofer')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'choferes' }, (cambio) => {
        if (cambio.new?.id === perfil.id) setChofer(cambio.new)
        cargarTablero()
      })
      .subscribe()

    return () => {
      clearInterval(intervalo)
      document.removeEventListener('visibilitychange', alVolver)
      supabase.removeChannel(canal)
    }
  }, [perfil.id, cargarTablero])

  async function llamar(funcion, parametros) {
    setError('')
    setOcupado(true)
    const { data, error } = await supabase.rpc(funcion, parametros)
    setOcupado(false)
    if (error) setError(textoError(error))
    else { setChofer(data); cargarTablero() }
  }
  const cambiarEstado = (nuevo) => llamar('cambiar_mi_estado', { nuevo })

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
  const cola = companeros.filter((c) => c.estado === 'en_cola')
    .sort((a, b) => new Date(a.anunciado_en) - new Date(b.anunciado_en))
  const yendo = companeros.filter((c) => c.estado === 'yendo')
  const enViaje = companeros.filter((c) => c.estado === 'en_viaje')
  const miPuesto = cola.findIndex((c) => c.id === perfil.id) + 1
  const puedeAnunciarse = !chofer.oculto && (estado === 'conectado' || estado === 'yendo')

  return (
    <main className="pantalla">
      <h1>Hola, {perfil.nombre}</h1>

      <div className={'estado-grande ' + estado}>
        {NOMBRE_ESTADO[estado]}
        {estado === 'en_cola' && miPuesto > 0 && <div className="puesto">Puesto {miPuesto}</div>}
      </div>
      {estado === 'conectado' && <p className="ayuda centrada">Tenés la app abierta, pero todavía no estás trabajando.</p>}
      {estado === 'yendo' && <p className="ayuda centrada">Avisaste que vas para la base.</p>}
      {estado === 'desconectado' && <p className="ayuda centrada">No estás trabajando.</p>}
      {chofer.oculto && <p className="ayuda centrada">Solo recibís viajes que te asigna gestión.</p>}

      <div className="botonera">
        {puedeAnunciarse && (
          <button className="boton grande verde" disabled={ocupado} onClick={() => llamar('anunciarme')}>✋ Anunciarme</button>
        )}
        {estado === 'en_cola' && (
          <button className="boton secundario" disabled={ocupado} onClick={() => llamar('salir_de_cola')}>Darme de baja de la cola</button>
        )}
        {estado === 'conectado' && (
          <button className="boton secundario" disabled={ocupado} onClick={() => cambiarEstado('yendo')}>🚗 Yendo a la base</button>
        )}
        {estado === 'yendo' && (
          <button className="boton secundario" disabled={ocupado} onClick={() => cambiarEstado('conectado')}>Ya no voy</button>
        )}
        {estado === 'desconectado' && (
          <button className="boton grande" disabled={ocupado} onClick={() => cambiarEstado('conectado')}>Conectarme</button>
        )}
        {estado !== 'desconectado' && estado !== 'en_viaje' && (
          <button className="boton secundario" disabled={ocupado} onClick={() => cambiarEstado('desconectado')}>Desconectarme</button>
        )}
      </div>
      {error && <p className="aviso error">{error}</p>}

      <section className="tarjeta separada">
        <h2>Cola ({cola.length})</h2>
        {cola.length === 0 && <p className="ayuda sin-margen">No hay nadie en la cola.</p>}
        <ol className="cola">
          {cola.map((c) => (
            <li key={c.id} className={c.id === perfil.id ? 'yo' : ''}>{c.perfiles?.nombre}{c.id === perfil.id && ' (vos)'}</li>
          ))}
        </ol>
        {yendo.length > 0 && (
          <p className="sin-margen"><strong>Yendo:</strong> {yendo.map((c) => c.perfiles?.nombre).join(', ')}</p>
        )}
        {enViaje.length > 0 && (
          <p className="sin-margen"><strong>En viaje:</strong> {enViaje.map((c) => c.perfiles?.nombre).join(', ')}</p>
        )}
      </section>

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
