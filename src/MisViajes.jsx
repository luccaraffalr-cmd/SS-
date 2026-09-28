import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { textoError } from './estados.js'
import { cuando, hora, tiempoRestante } from './viajes.js'

// App del chofer: ofertas para aceptar o rechazar, su viaje actual y los próximos.
export default function MisViajes({ perfil }) {
  const [viajes, setViajes] = useState([]) // ofrecidos y asignados, sin finalizar
  const [ahora, setAhora] = useState(Date.now())
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [confirmandoRechazo, setConfirmandoRechazo] = useState(null)

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('viajes').select('*')
      .eq('chofer_id', perfil.id).in('estado', ['ofrecido', 'asignado'])
      .order('asignado_en')
    setViajes(data ?? [])
  }, [perfil.id])

  useEffect(() => {
    cargar()
    // Cambios en sus viajes y en sus ofertas (por ejemplo, si gestión se lo saca) llegan al instante.
    const canal = supabase.channel('mis-viajes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'viajes', filter: `chofer_id=eq.${perfil.id}` }, cargar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ofertas', filter: `chofer_id=eq.${perfil.id}` }, cargar)
      .subscribe()
    const alVolver = () => { if (document.visibilityState === 'visible') cargar() }
    document.addEventListener('visibilitychange', alVolver)
    // Respaldo: cada 20 segundos revisa (y hace pasar al siguiente las ofertas vencidas).
    const revisar = setInterval(async () => { await supabase.rpc('revisar_asignaciones'); cargar() }, 20 * 1000)
    const reloj = setInterval(() => setAhora(Date.now()), 1000)
    return () => {
      supabase.removeChannel(canal)
      document.removeEventListener('visibilitychange', alVolver)
      clearInterval(revisar)
      clearInterval(reloj)
    }
  }, [perfil.id, cargar])

  async function llamar(funcion, viaje) {
    setError('')
    setOcupado(true)
    const { error } = await supabase.rpc(funcion, { viaje })
    setOcupado(false)
    setConfirmandoRechazo(null)
    if (error) setError(textoError(error))
    cargar()
  }

  const ofertas = viajes.filter((v) => v.estado === 'ofrecido'
    && (!v.oferta_vence || new Date(v.oferta_vence).getTime() > ahora))
  const actual = viajes.find((v) => v.estado === 'asignado' && v.iniciado_en)
  const aceptados = viajes.filter((v) => v.estado === 'asignado' && !v.iniciado_en)

  return (
    <>
      {error && <p className="aviso error">{error}</p>}

      {ofertas.map((v) => {
        const automatica = !!v.oferta_vence
        return (
          <section key={v.id} className="tarjeta separada oferta">
            <h2>{automatica ? '🔔 Viaje para vos' : '📌 Gestión te asignó un viaje'}</h2>
            {automatica && <div className="cuenta-regresiva">{tiempoRestante(v.oferta_vence, ahora)}</div>}
            <p className="viaje-hora sin-margen">{cuando(v)}</p>
            <div className="dato"><small>Buscar en</small><strong>{v.origen}</strong></div>
            <div className="dato"><small>Destino</small><strong>{v.destino || 'Sin destino cargado'}</strong></div>
            {v.observaciones && <div className="dato"><small>Observaciones</small>{v.observaciones}</div>}

            {confirmandoRechazo === v.id ? (
              <>
                <p className="aviso sin-margen">
                  {automatica
                    ? '¿Seguro? Si lo rechazás, salís de la cola y te tenés que volver a anunciar.'
                    : '¿Seguro? El viaje vuelve a gestión.'}
                </p>
                <button className="boton peligro" disabled={ocupado} onClick={() => llamar('rechazar_viaje', v.id)}>Sí, rechazar</button>
                <button className="boton secundario" onClick={() => setConfirmandoRechazo(null)}>No, volver</button>
              </>
            ) : (
              <div className="dos-columnas">
                <button className="boton peligro" disabled={ocupado} onClick={() => setConfirmandoRechazo(v.id)}>Rechazar</button>
                <button className="boton verde" disabled={ocupado} onClick={() => llamar('aceptar_viaje', v.id)}>✅ Aceptar</button>
              </div>
            )}
          </section>
        )
      })}

      {actual && (
        <section className="tarjeta separada mi-viaje">
          <h2>🚕 Tu viaje #{actual.id}</h2>
          <p className="viaje-hora sin-margen">
            {actual.tipo === 'programado' ? <>Presentarse a las {hora(actual.hora_presentacion)}</> : 'Inmediato'}
          </p>
          <div className="dato"><small>Buscar en</small><strong>{actual.origen}</strong></div>
          {actual.destino && <div className="dato"><small>Destino</small><strong>{actual.destino}</strong></div>}
          {actual.cliente_nombre && <div className="dato"><small>Cliente</small><strong>{actual.cliente_nombre}</strong></div>}
          {actual.observaciones && <div className="dato"><small>Observaciones</small>{actual.observaciones}</div>}
          {actual.cliente_telefono && (
            <a className="boton" href={'tel:' + actual.cliente_telefono}>📞 Llamar al cliente ({actual.cliente_telefono})</a>
          )}
        </section>
      )}

      {aceptados.length > 0 && (
        <section className="tarjeta separada">
          <h2>Tus próximos viajes</h2>
          {aceptados.map((v) => {
            const llegoLaHora = new Date(v.hora_asignacion).getTime() <= ahora
            return (
              <div key={v.id} className={'proximo' + (llegoLaHora ? ' es-hora' : '')}>
                <strong>#{v.id} · {cuando(v)}</strong>
                <span>{v.origen}{v.destino ? ' → ' + v.destino : ''}</span>
                {v.cliente_nombre && <small>{v.cliente_nombre}</small>}
                {llegoLaHora && !actual && (
                  <button className="boton verde" disabled={ocupado} onClick={() => llamar('salir_a_hacer_viaje', v.id)}>
                    🚗 Salir a hacer el viaje
                  </button>
                )}
                {llegoLaHora && actual && <small>Cuando termines el viaje actual, salí a hacer este.</small>}
                {!llegoLaHora && <small>Se habilita a las {hora(v.hora_asignacion)}.</small>}
              </div>
            )
          })}
        </section>
      )}
    </>
  )
}
