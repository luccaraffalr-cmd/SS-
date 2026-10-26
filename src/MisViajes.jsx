import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { textoError } from './estados.js'
import { cuando, hora } from './viajes.js'
import FormPago from './FormPago.jsx'
import { useAtras } from './atras.js'
import { pitido } from './notificaciones.js'
import { avisosConLaAppAbierta } from './notificacionesApp.js'
import VerAdjuntos from './Adjuntos.jsx'
import DevolverViaje from './DevolverViaje.jsx'
import { tieneAdjuntos } from './adjuntos.js'

// Origen destacado (22/10/2026: los choferes se confundían con el destino): recuadro verde "📍 BUSCAR EN" con letra grande.
function BloqueOrigen({ viaje }) {
  return (
    <div className="buscar-en">
      <small>📍 Buscar en</small>
      <strong className="viaje-titulo">{viaje.origen}</strong>
      <VerAdjuntos campo="origen" adjuntos={viaje.adjuntos} />
    </div>
  )
}

// El destino, abajo y más chico: "Llevar a: …". sinDestino: qué decir si no tiene (si no se pasa, no se muestra nada).
function LineaDestino({ viaje, sinDestino }) {
  if (!viaje.destino && !sinDestino && !tieneAdjuntos(viaje, 'destino')) return null
  return (
    <div className="llevar-a">
      Llevar a: <strong>{viaje.destino || sinDestino || 'sin destino cargado'}</strong>
      <VerAdjuntos campo="destino" adjuntos={viaje.adjuntos} />
    </div>
  )
}

// Ofertas de la cola: 2 minutos y medio para contestar (22/10/2026); si no, el viaje pasa al siguiente.
function TiempoParaContestar({ vence, ahora }) {
  const quedan = Math.max(0, Math.ceil((new Date(vence).getTime() - ahora) / 1000))
  if (quedan === 0) return <p className="tiempo-oferta poco">⌛ Se terminó el tiempo: el viaje pasa al siguiente.</p>
  return (
    <p className={'tiempo-oferta' + (quedan <= 30 ? ' poco' : '')}>
      ⏱️ Te quedan <strong>{Math.floor(quedan / 60)}:{String(quedan % 60).padStart(2, '0')}</strong> para contestar
    </p>
  )
}

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
  const [devolviendo, setDevolviendo] = useState(null) // id del viaje que está devolviendo (26/10/2026)
  useAtras(devolviendo !== null, () => setDevolviendo(null))

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
    // (La app versión 3 o más ya hace sonar el aviso con la app abierta: no hace falta el pitido.)
    if (idsOfertas.split(',').some((id) => !vistas.has(id))) avisosConLaAppAbierta().then((suena) => { if (!suena) pitido() })
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
            {automatica && v.oferta_vence && <TiempoParaContestar vence={v.oferta_vence} ahora={ahora} />}
            {/* Que no elijan los viajes por a dónde van (pedidos del dueño): en los inmediatos no se ve nada de la dirección
                ni las observaciones hasta aceptar (26/10/2026); en los programados, el destino (24/10/2026). */}
            {v.tipo === 'inmediato' ? (
              <div className="buscar-en">
                <small>📍 Buscar en</small>
                <strong className="viaje-titulo">🔒 Lo ves cuando lo aceptes</strong>
              </div>
            ) : (
              <>
                <BloqueOrigen viaje={v} />
                <div className="llevar-a">Llevar a: <strong>🔒 lo ves cuando lo aceptes</strong></div>
              </>
            )}
            <div className="dato"><small>Cuándo</small><strong>{cuando(v)}</strong></div>
            {v.tipo !== 'inmediato' && (v.observaciones || tieneAdjuntos(v, 'observaciones')) && (
              <div className="dato">
                <small>Observaciones</small>{v.observaciones && <span className="texto-dato">{v.observaciones}</span>}
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
          <BloqueOrigen viaje={actual} />
          <LineaDestino viaje={actual} />
          {actual.cliente_nombre && <div className="dato"><small>Cliente</small><strong>{actual.cliente_nombre}</strong></div>}
          <div className="dato">
            <small>Cuándo</small>
            <strong>{actual.tipo === 'programado' ? <>Presentarse a las {hora(actual.hora_presentacion)}</> : 'Inmediato'}</strong>
          </div>
          {(actual.observaciones || tieneAdjuntos(actual, 'observaciones')) && (
            <div className="dato">
              <small>Observaciones</small>{actual.observaciones && <span className="texto-dato">{actual.observaciones}</span>}
              <VerAdjuntos campo="observaciones" adjuntos={actual.adjuntos} />
            </div>
          )}
          {actual.cliente_telefono && (
            <a className="boton" href={'tel:' + actual.cliente_telefono}>📞 Llamar al cliente ({actual.cliente_telefono})</a>
          )}

          {finalizando === null && devolviendo !== actual.id && (
            <>
              <button className="boton grande verde" onClick={() => setFinalizando('elegir')}>🏁 Finalicé</button>
              <button className="boton-devolver" onClick={() => setDevolviendo(actual.id)}>↩️ No puedo seguir: devolver el viaje</button>
            </>
          )}
          {devolviendo === actual.id && (
            <DevolverViaje viaje={actual} perfilId={perfil.id}
              onListo={() => { setDevolviendo(null); cargar() }} onCancelar={() => setDevolviendo(null)} />
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
            <FormPago textoBoton="Finalizar viaje" pedirDestino={!actual.destino}
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
                <BloqueOrigen viaje={v} />
                <LineaDestino viaje={v} />
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
                {devolviendo === v.id ? (
                  <DevolverViaje viaje={v} perfilId={perfil.id}
                    onListo={() => { setDevolviendo(null); cargar() }} onCancelar={() => setDevolviendo(null)} />
                ) : (
                  <button className="boton-devolver" onClick={() => setDevolviendo(v.id)}>↩️ No lo puedo hacer: devolverlo</button>
                )}
              </div>
            )
          })}
        </section>
      )}
    </>
  )
}
