import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { textoError } from './estados.js'
import { cuando, hora } from './viajes.js'
import FormPago from './FormPago.jsx'
import { useAtras } from './atras.js'
import { pitido } from './notificaciones.js'
import VerAdjuntos from './Adjuntos.jsx'
import { tieneAdjuntos } from './adjuntos.js'

// App del chofer: ofertas para aceptar o rechazar, su viaje actual y los próximos.
// Los viajes sin cargar el pago los muestra ViajesSinCargar abajo de todo: se los pasa con onSinPago.
export default function MisViajes({ perfil, onSinPago }) {
  const [viajes, setViajes] = useState([]) // ofrecidos y asignados, sin finalizar
  const [ahora, setAhora] = useState(Date.now())
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [confirmandoRechazo, setConfirmandoRechazo] = useState(null)
  // Al finalizar: null | 'elegir' | 'pago' | 'fallido'
  const [finalizando, setFinalizando] = useState(null)
  const [motivo, setMotivo] = useState('')

  // El botón atrás del celular hace lo mismo que "Volver".
  useAtras(finalizando !== null, () => setFinalizando(null))
  useAtras(finalizando === 'pago' || finalizando === 'fallido', () => setFinalizando('elegir'))
  useAtras(confirmandoRechazo !== null, () => setConfirmandoRechazo(null))

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('viajes').select('*')
      .eq('chofer_id', perfil.id).in('estado', ['ofrecido', 'asignado', 'pago_pendiente'])
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

  // Terminar el viaje actual: opcion = 'pago' | 'despues' | 'fallido'. Devuelve el error (texto) o nada.
  async function finalizar(viaje, opcion, extra = {}) {
    setError('')
    setOcupado(true)
    const { error } = await supabase.rpc('finalizar_viaje', { viaje, opcion, ...extra })
    setOcupado(false)
    if (error) return textoError(error)
    setFinalizando(null)
    setMotivo('')
    cargar()
  }

  const ofertas = viajes.filter((v) => v.estado === 'ofrecido')

  // Con la app abierta: pitido cuando aparece una oferta nueva.
  const idsOfertas = ofertas.map((v) => v.id).join(',')
  const [ofertasVistas, setOfertasVistas] = useState('')
  useEffect(() => {
    if (!idsOfertas) { setOfertasVistas(''); return }
    const vistas = new Set(ofertasVistas.split(','))
    if (idsOfertas.split(',').some((id) => !vistas.has(id))) pitido()
    setOfertasVistas(idsOfertas)
  }, [idsOfertas]) // eslint-disable-line react-hooks/exhaustive-deps
  const actual = viajes.find((v) => v.estado === 'asignado' && v.iniciado_en)
  const aceptados = viajes.filter((v) => v.estado === 'asignado' && !v.iniciado_en)
  const sinPago = viajes.filter((v) => v.estado === 'pago_pendiente')
  const clavesSinPago = sinPago.map((v) => v.id).join(',')
  useEffect(() => { onSinPago?.(sinPago) }, [clavesSinPago]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {error && <p className="aviso error">{error}</p>}

      {ofertas.map((v) => {
        const automatica = !v.asignado_por
        return (
          <section key={v.id} className="tarjeta separada oferta">
            <h2>{automatica ? '🔔 Viaje para vos' : '📌 Gestión te asignó un viaje'}</h2>
            <div className="dato">
              <small>Buscar en</small><strong className="viaje-titulo">{v.origen}</strong>
              <VerAdjuntos campo="origen" adjuntos={v.adjuntos} />
            </div>
            <div className="dato">
              <small>Destino</small><strong>{v.destino || 'Sin destino cargado'}</strong>
              <VerAdjuntos campo="destino" adjuntos={v.adjuntos} />
            </div>
            <div className="dato"><small>Cuándo</small><strong>{cuando(v)}</strong></div>
            {(v.observaciones || tieneAdjuntos(v, 'observaciones')) && (
              <div className="dato">
                <small>Observaciones</small>{v.observaciones}
                <VerAdjuntos campo="observaciones" adjuntos={v.adjuntos} />
              </div>
            )}

            {confirmandoRechazo === v.id ? (
              <>
                <p className="aviso sin-margen">
                  {automatica
                    ? '¿Seguro? El viaje pasa al siguiente de la cola. Vos seguís primero.'
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
          <div className="dato">
            <small>Buscar en</small><strong className="viaje-titulo">{actual.origen}</strong>
            <VerAdjuntos campo="origen" adjuntos={actual.adjuntos} />
          </div>
          {(actual.destino || tieneAdjuntos(actual, 'destino')) && (
            <div className="dato">
              <small>Destino</small><strong>{actual.destino}</strong>
              <VerAdjuntos campo="destino" adjuntos={actual.adjuntos} />
            </div>
          )}
          {actual.cliente_nombre && <div className="dato"><small>Cliente</small><strong>{actual.cliente_nombre}</strong></div>}
          <div className="dato">
            <small>Cuándo</small>
            <strong>{actual.tipo === 'programado' ? <>Presentarse a las {hora(actual.hora_presentacion)}</> : 'Inmediato'}</strong>
          </div>
          {(actual.observaciones || tieneAdjuntos(actual, 'observaciones')) && (
            <div className="dato">
              <small>Observaciones</small>{actual.observaciones}
              <VerAdjuntos campo="observaciones" adjuntos={actual.adjuntos} />
            </div>
          )}
          {actual.cliente_telefono && (
            <a className="boton" href={'tel:' + actual.cliente_telefono}>📞 Llamar al cliente ({actual.cliente_telefono})</a>
          )}

          {finalizando === null && (
            <button className="boton grande verde" onClick={() => setFinalizando('elegir')}>🏁 Finalicé</button>
          )}
          {finalizando === 'elegir' && (
            <div className="botonera">
              <p className="sin-margen"><strong>¿Cómo terminó el viaje?</strong></p>
              <button className="boton verde" onClick={() => setFinalizando('pago')}>💵 Cargar el pago ahora</button>
              <button className="boton" disabled={ocupado} onClick={async () => {
                const err = await finalizar(actual.id, 'despues'); if (err) setError(err)
              }}>⏳ Cargar el pago después</button>
              <button className="boton peligro" onClick={() => setFinalizando('fallido')}>❌ Fallido (no se hizo)</button>
              <button className="boton secundario" onClick={() => setFinalizando(null)}>Volver</button>
            </div>
          )}
          {finalizando === 'pago' && (
            <FormPago textoBoton="Finalizar viaje"
              onGuardar={(importe, forma_pago, cuenta, otro, extras) =>
                finalizar(actual.id, 'pago', { importe, forma_pago, cuenta, otro, ...extras })}
              onCancelar={() => setFinalizando('elegir')} />
          )}
          {finalizando === 'fallido' && (
            <div className="botonera">
              <label>
                Motivo (opcional)
                <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                  placeholder="ej: el cliente no estaba" />
              </label>
              <p className="ayuda sin-margen">Volvés al puesto 1 de la cola.</p>
              <button className="boton peligro" disabled={ocupado} onClick={async () => {
                const err = await finalizar(actual.id, 'fallido', { motivo }); if (err) setError(err)
              }}>Marcar como fallido</button>
              <button className="boton secundario" onClick={() => setFinalizando('elegir')}>Volver</button>
            </div>
          )}
        </section>
      )}

      {aceptados.length > 0 && (
        <section className="tarjeta separada">
          <h2>Tus viajes asignados</h2>
          {aceptados.map((v) => {
            const llegoLaHora = new Date(v.hora_asignacion).getTime() <= ahora
            return (
              <div key={v.id} className={'proximo' + (llegoLaHora ? ' es-hora' : '')}>
                <strong className="viaje-titulo">{v.origen}</strong>
                <VerAdjuntos campo="origen" adjuntos={v.adjuntos} />
                {v.destino && <span>→ {v.destino}</span>}
                <VerAdjuntos campo="destino" adjuntos={v.adjuntos} />
                {v.cliente_nombre && <small>{v.cliente_nombre}</small>}
                <VerAdjuntos campo="observaciones" adjuntos={v.adjuntos} />
                <span className="viaje-cuando">{cuando(v)} · #{v.id}</span>
                {llegoLaHora && !actual && (
                  <button className="boton verde" disabled={ocupado} onClick={() => llamar('salir_a_hacer_viaje', v.id)}>
                    🚗 Salir a hacer el viaje
                  </button>
                )}
                {llegoLaHora && actual && <small>Cuando termines el viaje actual, salí a hacer este.</small>}
                {!llegoLaHora && <small>Se habilita a las {hora(v.hora_asignacion)} (te va a sonar un aviso).</small>}
              </div>
            )
          })}
        </section>
      )}
    </>
  )
}
