import { useEffect, useState } from 'react'
import { Ubicacion, dejarDeCompartir, empezarACompartir } from './ubicacionApp.js'
import { textoError } from './estados.js'

// Si pasa más que esto sin mandar, algo anda mal (sin señal, GPS apagado…).
const SEGUNDOS_SIN_ENVIO = 120

// Solo en la app Android. La ubicación se comparte sola mientras el chofer trabaja
// (Libre, En cola o En viaje) y se apaga al "Terminar el día". Acá solo se avisa si falta configurar algo.
export default function UbicacionApp({ perfil, estadoChofer }) {
  const [estado, setEstado] = useState(null)
  const [error, setError] = useState('')
  const [ahora, setAhora] = useState(Date.now())
  const trabajando = !!estadoChofer && estadoChofer !== 'fuera_de_servicio'

  useEffect(() => {
    const revisar = () => Ubicacion.estado().then(setEstado).catch(() => {})
    revisar()
    // Al volver de los ajustes del celular, y cada tanto, se actualiza.
    const alVolver = () => { if (document.visibilityState === 'visible') revisar() }
    document.addEventListener('visibilitychange', alVolver)
    const reloj = setInterval(() => { setAhora(Date.now()); revisar() }, 5000)
    return () => { document.removeEventListener('visibilitychange', alVolver); clearInterval(reloj) }
  }, [])

  // Prende o apaga según el estado del chofer. Al abrir la app (o volver a ella) se vuelve a
  // prender por las dudas: si Android cortó el servicio, así arranca de nuevo.
  const tienePermiso = !!estado && estado.ubicacion !== 'no'
  useEffect(() => {
    if (!estadoChofer || !estado) return
    async function sincronizar() {
      try {
        if (trabajando && tienePermiso) setEstado(await empezarACompartir(perfil.id))
        else if (!trabajando && estado.activo) setEstado(await dejarDeCompartir())
        setError('')
      } catch (e) { setError(textoError(e)) }
    }
    sincronizar()
    const alVolver = () => { if (document.visibilityState === 'visible') sincronizar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trabajando, tienePermiso, perfil.id, !!estado])

  async function hacer(accion) {
    setError('')
    try { setEstado(await accion()) } catch (e) { setError(textoError(e)) }
  }

  if (!estado) return null

  const pasos = [
    {
      listo: estado.ubicacion === 'precisa',
      texto: 'Permiso de ubicación (precisa)',
      boton: estado.ubicacion === 'no' ? 'Dar permiso' : 'Cambiar a precisa',
      accion: () => (estado.ubicacion === 'no' ? Ubicacion.pedirUbicacion() : Ubicacion.abrirAjustes()),
    },
    {
      listo: estado.segundoPlano,
      texto: 'Ubicación "Permitir todo el tiempo"',
      ayuda: 'En la pantalla que se abre, elegí "Permitir todo el tiempo".',
      boton: 'Configurar',
      accion: () => Ubicacion.pedirSegundoPlano(),
      necesita: estado.ubicacion !== 'no',
    },
    {
      listo: estado.bateria,
      texto: 'Batería sin restricciones',
      ayuda: 'Si pregunta, tocá "Permitir".',
      boton: 'Configurar',
      accion: () => Ubicacion.pedirBateria(),
    },
    {
      listo: estado.notificaciones,
      texto: 'Notificaciones activadas',
      boton: 'Activar',
      accion: () => Ubicacion.pedirUbicacion().then((e) => (e.notificaciones ? e : Ubicacion.abrirAjustes())),
    },
    { listo: estado.gps, texto: 'GPS (Ubicación) prendido', ayuda: 'Prendelo desde la barra de arriba del celular.' },
  ]
  const faltaAlgo = pasos.some((p) => !p.listo)
  const segundos = estado.ultimoEnvio ? Math.round((ahora - estado.ultimoEnvio) / 1000) : null
  const sinEnviar = trabajando && estado.activo && (segundos === null ? false : segundos > SEGUNDOS_SIN_ENVIO)

  // Todo bien: una línea chiquita (o nada si no está trabajando).
  if (!faltaAlgo && !sinEnviar && !error) {
    if (!trabajando) return null
    return (
      <p className="ayuda centrada">
        📍 Compartiendo tu ubicación{segundos !== null && ` · último envío hace ${segundos} s`}
      </p>
    )
  }

  return (
    <section className={'tarjeta separada ubicacion-app' + (trabajando ? ' falta' : '')}>
      <h2>📍 {trabajando ? 'Tu ubicación no se está compartiendo bien' : 'Configurá la ubicación'}</h2>
      <p className="sin-margen">
        {trabajando
          ? 'Mientras trabajás, gestión tiene que ver dónde estás. Activá lo que falta:'
          : 'Antes de empezar a trabajar, dejá todo esto en ✅ (se hace una sola vez):'}
      </p>
      {sinEnviar && (
        <p className="aviso error sin-margen">
          Hace {Math.round(segundos / 60)} min que no se manda tu ubicación. Revisá que tengas internet y el GPS prendido.
          {estado.ultimoError && <><br /><small>{estado.ultimoError}</small></>}
        </p>
      )}
      <ul className="pasos-config">
        {pasos.map((p) => (
          <li key={p.texto} className={p.listo ? 'listo' : ''}>
            <span>{p.listo ? '✅' : '⚠️'} {p.texto}{!p.listo && p.ayuda && <small>{p.ayuda}</small>}</span>
            {!p.listo && p.accion && p.necesita !== false && (
              <button type="button" className="boton-chico" onClick={() => hacer(p.accion)}>{p.boton}</button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="aviso error">{error}</p>}
    </section>
  )
}
