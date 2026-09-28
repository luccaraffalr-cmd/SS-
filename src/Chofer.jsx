import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { urlFotoAuto } from './fotos.js'
import { NOMBRE_ESTADO, textoError } from './estados.js'
import MisViajes from './MisViajes.jsx'
import ActivarNotificaciones from './ActivarNotificaciones.jsx'
import ProximosViajes, { AlertaSinChoferChofer } from './ViajesEsperando.jsx'

const AYUDA_ESTADO = {
  fuera_de_servicio: 'No estás trabajando.',
  libre: 'Estás trabajando, pero no estás anunciado en la base.',
  en_cola: '',
  en_viaje: 'Tenés un viaje asignado.',
}

// App del chofer: su estado, la cola y quién está libre o en viaje.
export default function Chofer({ perfil }) {
  const [chofer, setChofer] = useState(null)
  const [companeros, setCompaneros] = useState([])
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const cargarTablero = useCallback(async () => {
    const { data } = await supabase.from('choferes')
      .select('id, estado, anunciado_en, perfiles(nombre)')
      .in('estado', ['en_cola', 'libre', 'en_viaje'])
    setCompaneros(data ?? [])
  }, [])

  // Carga sus datos al abrir la app y al volver a ella. ("Último reporte" se anota
  // solo cuando el chofer toca un botón, en el servidor.)
  useEffect(() => {
    async function cargarMisDatos() {
      const { data, error } = await supabase.from('choferes').select('*').eq('id', perfil.id).maybeSingle()
      if (error || !data) setError('No se pudo conectar con el servidor. Revisá tu internet.')
      else { setError(''); setChofer(data) }
    }
    cargarMisDatos()
    cargarTablero()
    const alVolver = () => {
      if (document.visibilityState === 'visible') { cargarMisDatos(); cargarTablero() }
    }
    document.addEventListener('visibilitychange', alVolver)

    // Cualquier cambio en los choferes (el propio o los compañeros) llega al instante.
    const canal = supabase.channel('tablero-chofer')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'choferes' }, (cambio) => {
        if (cambio.new?.id === perfil.id) setChofer(cambio.new)
        cargarTablero()
      })
      .subscribe()

    return () => {
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
  const libres = companeros.filter((c) => c.estado === 'libre')
  const enViaje = companeros.filter((c) => c.estado === 'en_viaje')
  const miPuesto = cola.findIndex((c) => c.id === perfil.id) + 1
  const puedeAnunciarse = !chofer.oculto && (estado === 'libre' || estado === 'fuera_de_servicio')

  return (
    <main className="pantalla">
      <AlertaSinChoferChofer />
      <h1>Hola, {perfil.nombre}</h1>
      <ActivarNotificaciones />

      <div className={'estado-grande ' + estado}>
        {NOMBRE_ESTADO[estado]}
        {estado === 'en_cola' && miPuesto > 0 && <div className="puesto">Puesto {miPuesto}</div>}
      </div>
      {AYUDA_ESTADO[estado] && <p className="ayuda centrada">{AYUDA_ESTADO[estado]}</p>}
      {chofer.oculto && <p className="ayuda centrada">Solo recibís viajes que te asigna gestión.</p>}

      <div className="botonera">
        {puedeAnunciarse && (
          <button className="boton grande verde" disabled={ocupado} onClick={() => llamar('anunciarme')}>✋ Anunciarme</button>
        )}
        {estado === 'fuera_de_servicio' && (
          <button className="boton grande" disabled={ocupado} onClick={() => cambiarEstado('libre')}>Empezar a trabajar</button>
        )}
        {estado === 'en_cola' && (
          <button className="boton secundario" disabled={ocupado} onClick={() => llamar('salir_de_cola')}>Darme de baja de la cola</button>
        )}
        {(estado === 'libre' || estado === 'en_cola') && (
          <button className="boton secundario" disabled={ocupado} onClick={() => cambiarEstado('fuera_de_servicio')}>Terminar el día</button>
        )}
      </div>
      {error && <p className="aviso error">{error}</p>}

      <MisViajes perfil={perfil} />
      <ProximosViajes />

      <section className="tarjeta separada">
        <h2>Cola ({cola.length})</h2>
        {cola.length === 0 && <p className="ayuda sin-margen">No hay nadie en la cola.</p>}
        <ol className="cola">
          {cola.map((c) => (
            <li key={c.id} className={c.id === perfil.id ? 'yo' : ''}>{c.perfiles?.nombre}{c.id === perfil.id && ' (vos)'}</li>
          ))}
        </ol>
        {libres.length > 0 && (
          <p className="sin-margen"><strong>Libres:</strong> {libres.map((c) => c.perfiles?.nombre).join(', ')}</p>
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

      <button className="boton secundario" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
    </main>
  )
}
