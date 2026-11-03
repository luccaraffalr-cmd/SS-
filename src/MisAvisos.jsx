import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { useAtras } from './atras.js'

// Los avisos que le llegan a cada uno (los mismos nombres que usa "notificar"). fijo: suena siempre (sus propios viajes).
const AVISOS = [
  { id: 'oferta', para: 'chofer', fijo: true, texto: '🔔 Viaje para vos / 📌 Gestión te asignó un viaje',
    ayuda: 'Cuando te ofrecen o te asignan un viaje.' },
  { id: 'hora_de_salir', para: 'chofer', fijo: true, texto: '🚗 Es hora de salir / ⏰ Todavía no saliste',
    ayuda: 'A la hora de salir a hacer tu viaje, y cada 2 minutos hasta que salgas.' },
  { id: 'cambio', para: 'chofer', texto: '🔄 Cambió tu viaje', ayuda: 'Gestión le cambió el horario, la dirección o algo más.' },
  { id: 'anulado', para: 'chofer', texto: '❌ Se anuló tu viaje', ayuda: 'Gestión lo anuló o se lo pasó a otro chofer.' },
  { id: 'se_paso', para: 'chofer', texto: '⌛ Se te pasó el viaje', ayuda: 'No contestaste o no saliste a tiempo, y pasó a otro chofer.' },
  { id: 'para_tomar', para: 'chofer', texto: '🆘 Viaje sin chofer', ayuda: 'Nadie de la cola lo tomó: lo podés tomar vos.' },
  { id: 'salio', para: 'chofer', texto: '📣 Salió un viaje para otro chofer', ayuda: 'Para avisarle si no lo ve.' },
  { id: 'nadie_tomo', para: 'admin', texto: '⚠️ Nadie tomó el viaje', ayuda: 'Se liberó para que lo tome cualquier chofer.' },
  { id: 'sin_chofer', para: 'admin', texto: '⚠️ Viaje sin chofer', ayuda: 'Lo tenés que asignar desde gestión.' },
  { id: 'devolvio', para: 'admin', texto: '⚠️ Un chofer devolvió el viaje', ayuda: 'Vuelve a la cola como prioritario.' },
]

// "Mis avisos" (pedido del 2/11/2026): cada uno elige qué avisos le suenan. Los que pone sin sonido le llegan igual,
// callados (SQL 047; los separa la función "notificar"). Para choferes y gestión. desplegable: se abre al tocarlo
// (en la pantalla del chofer); si no, se muestra abierto (en "Mi cuenta" de gestión).
export default function MisAvisos({ perfil, desplegable = false }) {
  const [abierto, setAbierto] = useState(!desplegable)
  const [sinSonido, setSinSonido] = useState(null) // null = cargando
  const [error, setError] = useState('')
  const avisos = AVISOS.filter((a) => a.para === perfil.rol)
  useAtras(desplegable && abierto, () => setAbierto(false))

  // Se lee de nuevo al abrir (por si lo cambió en otro celular).
  useEffect(() => {
    if (!abierto) return
    supabase.from('perfiles').select('avisos_sin_sonido').eq('id', perfil.id).maybeSingle()
      .then(({ data, error }) => {
        if (error) setError('No se pudo cargar: ' + error.message)
        setSinSonido(data?.avisos_sin_sonido ?? [])
      })
  }, [abierto, perfil.id])

  async function alternar(id) {
    const anterior = sinSonido
    const nuevos = sinSonido.includes(id) ? sinSonido.filter((x) => x !== id) : [...sinSonido, id]
    setSinSonido(nuevos)
    setError('')
    const { error } = await supabase.rpc('guardar_avisos_sin_sonido', { p_tipos: nuevos })
    if (error) {
      setSinSonido(anterior)
      setError('No se pudo guardar: ' + error.message)
    }
  }

  const callados = (sinSonido ?? []).filter((id) => avisos.some((a) => a.id === id)).length
  return (
    <section className="tarjeta separada mis-avisos">
      {desplegable ? (
        <button type="button" className="boton-desplegar" onClick={() => setAbierto(!abierto)}>
          <span>🔔 Mis avisos: <strong>{callados ? `${callados} sin sonido` : 'suenan todos'}</strong></span>
          <span>{abierto ? '▲' : '▼'}</span>
        </button>
      ) : (
        <h2>🔔 Mis avisos</h2>
      )}
      {abierto && avisos.length === 0 && (
        <p className="ayuda sin-margen">Por ahora no te llega ningún aviso al celular.</p>
      )}
      {abierto && avisos.length > 0 && (
        <>
          <p className="ayuda sin-margen">
            Elegí cuáles te suenan. Los que pongas sin sonido te llegan igual al celular, pero callados.
          </p>
          {sinSonido === null && !error && <p className="sin-margen">Cargando…</p>}
          {sinSonido !== null && (
            <ul className="lista-avisos">
              {avisos.map((a) => {
                const suena = a.fijo || !sinSonido.includes(a.id)
                return (
                  <li key={a.id}>
                    <span>
                      <strong>{a.texto}</strong>
                      <small>{a.fijo ? `${a.ayuda} Siempre suena: es tu viaje.` : a.ayuda}</small>
                    </span>
                    <button type="button" className={'interruptor-aviso' + (suena ? ' suena' : '')} disabled={a.fijo}
                      onClick={() => alternar(a.id)}>
                      {suena ? '🔊 Suena' : '🔕 Sin sonido'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {error && <p className="aviso error sin-margen">{error}</p>}
        </>
      )}
    </section>
  )
}
