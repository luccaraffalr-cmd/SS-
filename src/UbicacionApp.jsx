import { useEffect, useState } from 'react'
import { Ubicacion, dejarDeCompartir, empezarACompartir } from './ubicacionApp.js'
import { textoError } from './estados.js'

// Solo en la app Android: compartir la ubicación y revisar que el celular esté bien configurado.
// (Prueba: por ahora se prende y apaga a mano; después irá con "Empezar a trabajar".)
export default function UbicacionApp({ perfil }) {
  const [estado, setEstado] = useState(null)
  const [error, setError] = useState('')
  const [ahora, setAhora] = useState(Date.now())

  useEffect(() => {
    const revisar = () => Ubicacion.estado().then(setEstado).catch(() => {})
    revisar()
    // Al volver de los ajustes del celular, y cada tanto, se actualiza.
    const alVolver = () => { if (document.visibilityState === 'visible') revisar() }
    document.addEventListener('visibilitychange', alVolver)
    const reloj = setInterval(() => { setAhora(Date.now()); revisar() }, 5000)
    return () => { document.removeEventListener('visibilitychange', alVolver); clearInterval(reloj) }
  }, [])

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
  const todoListo = pasos.every((p) => p.listo)
  const segundos = estado.ultimoEnvio ? Math.round((ahora - estado.ultimoEnvio) / 1000) : null

  return (
    <section className={'tarjeta separada ubicacion-app' + (estado.activo ? ' activa' : '')}>
      <h2>📍 Mi ubicación</h2>
      <p className="sin-margen">
        {estado.activo ? <strong>Compartiendo tu ubicación</strong> : 'No estás compartiendo tu ubicación.'}
        {estado.activo && (
          <><br /><small className="ayuda">
            {segundos === null ? 'Todavía no se mandó ninguna.' : `Último envío: hace ${segundos} s.`}
            {estado.ultimoError && ` ⚠️ ${estado.ultimoError}`}
          </small></>
        )}
      </p>

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
      {estado.activo ? (
        <button type="button" className="boton secundario" onClick={() => hacer(dejarDeCompartir)}>Dejar de compartir</button>
      ) : (
        <button type="button" className="boton verde" disabled={estado.ubicacion === 'no'}
          onClick={() => hacer(() => empezarACompartir(perfil.id))}>
          Empezar a compartir{!todoListo && ' (falta configurar)'}
        </button>
      )}
    </section>
  )
}
