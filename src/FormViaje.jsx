import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { NOMBRE_ESTADO_VIAJE, deFechaLocal, fechaLocal, hora, limiteParaSalir, problemaDelViaje, unirFechaHora } from './viajes.js'
import ElegirFechas from './ElegirFechas.jsx'
import ElegirHora from './ElegirHora.jsx'
import { useAtras } from './atras.js'
import { SEMANA, textoFechas, textoSerie } from './ViajesFijos.jsx'
import ElegirChofer, { useChoferesParaAsignar } from './ElegirChofer.jsx'
import FormPago from './FormPago.jsx'
import HistorialViaje from './HistorialViaje.jsx'
import CompartirViaje from './CompartirViaje.jsx'
import EstadoPlanilla from './EstadoPlanilla.jsx'
import { FORMAS_PAGO, dinero, fechaCorta, pagoSugerido, totalCobrado } from './viajes.js'
import ElegirCliente from './ElegirCliente.jsx'
import { cuandoSeOfrece } from './TarjetaViaje.jsx'
import { CampoConAdjuntos } from './Adjuntos.jsx'
import RecorridoViaje from './RecorridoViaje.jsx'
import ElegirExcluidos from './ElegirExcluidos.jsx'

// Explicación en palabras de en qué anda la asignación del viaje.
function textoSituacion(v) {
  const nombre = v.chofer?.nombre
  const problema = problemaDelViaje(v)
  // Si no sale en 5 minutos, la app se lo saca (SQL 049, 2/11/2026).
  const limite = limiteParaSalir(v)
  const seLoSaca = limite ? ` Si no sale antes de las ${hora(limite)}, la app se lo saca y lo manda a la cola.` : ''
  if (problema === 'no_salio') {
    return `⚠️ ${nombre} lo aceptó pero todavía no salió a hacerlo (se habilitó a las ${hora(v.hora_asignacion)}). `
      + 'Llamalo o asignáselo a otro.' + seLoSaca
  }
  if (problema === 'sin_aceptar') {
    return `⚠️ Asignado a mano a ${nombre}, pero todavía no lo aceptó y ya llegó la hora (${hora(v.hora_asignacion)}). `
      + 'Llamalo o asignáselo a otro.' + seLoSaca
  }
  if (v.estado === 'sin_chofer' && v.chofer_fijo) {
    return `📌 Chofer fijo: ${v.fijo?.nombre ?? '?'}. Se le ofrece el ${fechaCorta(cuandoSeOfrece(v))} (7 días antes) y lo tiene que aceptar. `
      + 'Si querés, elegí otro chofer o dejalo en automático.'
  }
  if (v.estado === 'sin_chofer' && v.espera_gestion) {
    return `❌ ${v.rechazo?.nombre ?? 'El chofer'} rechazó este viaje. No se asigna solo: elegí otro chofer o dejalo en automático.`
  }
  if (v.estado === 'sin_chofer') {
    return 'Esperando chofer: se le ofrece al primero de la cola. Si en un minuto nadie lo toma, cualquier chofer que esté '
      + 'trabajando lo puede tomar desde la app (y les suena un aviso).'
  }
  if (v.estado === 'ofrecido' && !v.asignado_por) {
    return `Se le ofreció a ${nombre} (primero de la cola). Esperando que acepte. Si no contesta en 2 minutos y medio, `
      + 'pasa solo al siguiente de la cola.'
  }
  if (v.estado === 'ofrecido') return `📌 Asignado a mano a ${nombre}. Esperando que lo acepte.`
  if (v.estado === 'asignado' && !v.iniciado_en) return `${nombre} lo aceptó. Todavía no salió a hacerlo.`
  if (v.estado === 'asignado') return `${nombre} está haciendo este viaje.`
  return ''
}

// Aprobación del pago (24/10/2026): quién y cuándo lo aprobó. Los admins lo aprueban o le quitan la aprobación (de un
// toque: el botón está adentro del viaje, no en la lista).
function AprobacionPago({ viaje, esAdmin, onListo }) {
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  async function llamar(funcion, parametros) {
    setError('')
    setOcupado(true)
    const { error } = await supabase.rpc(funcion, parametros)
    setOcupado(false)
    if (error) setError('No se pudo: ' + error.message)
    else onListo()
  }

  if (viaje.aprobado_en) {
    return (
      <>
        <p className="aviso ok sin-margen">
          ✅ Pago aprobado{viaje.aprobador?.nombre && ` por ${viaje.aprobador.nombre}`} el {fechaCorta(viaje.aprobado_en)} a
          las {hora(viaje.aprobado_en)}.
        </p>
        {esAdmin && (
          <button type="button" className="boton secundario" disabled={ocupado}
            onClick={() => llamar('quitar_aprobacion', { p_viaje: viaje.id })}>Quitar aprobación</button>
        )}
        {error && <p className="aviso error sin-margen">{error}</p>}
      </>
    )
  }
  if (!esAdmin) return <p className="ayuda sin-margen">El pago todavía no está aprobado.</p>
  return (
    <>
      <button type="button" className="boton verde" disabled={ocupado}
        onClick={() => llamar('aprobar_pagos', { p_viajes: [viaje.id] })}>✓ Aprobar el pago</button>
      {error && <p className="aviso error sin-margen">{error}</p>}
    </>
  )
}

const ANTICIPACION_POR_DEFECTO = 20 // 2/11/2026 (antes 30)
const ANTICIPACIONES_RAPIDAS = [10, 20, 30, 45]

// Alta y edición de un viaje (gestión). fechaInicial ("2026-10-15"): viaje nuevo cargado desde un día del calendario;
// si no es hoy, arranca como programado para ese día. inicial ({ origen, observaciones, adjuntos }): viaje nuevo que
// arranca con algo compartido desde WhatsApp (2/11/2026); { cliente }: desde la ficha del cliente (2/11/2026).
// onVolver: qué hace "Volver" (si no, lo mismo que al guardar).
export default function FormViaje({ viaje, fechaInicial, inicial, onListo, onVolver, esAdmin = false }) {
  const esNuevo = !viaje
  const [datos, setDatos] = useState(() => {
    const presentacion = viaje?.hora_presentacion ? new Date(viaje.hora_presentacion) : null
    const otroDia = !!fechaInicial && fechaInicial !== fechaLocal()
    const cliente = inicial?.cliente
    return {
      tipo: viaje?.tipo ?? (otroDia ? 'programado' : 'inmediato'),
      cliente_id: viaje?.cliente_id ?? cliente?.id ?? null,
      cliente_nombre: viaje?.cliente_nombre ?? cliente?.nombre ?? '',
      cliente_telefono: viaje?.cliente_telefono ?? cliente?.telefono ?? '',
      origen: viaje?.origen ?? inicial?.origen ?? '',
      destino: viaje?.destino ?? '',
      observaciones: viaje?.observaciones ?? inicial?.observaciones ?? cliente?.nota ?? '',
      fecha: presentacion ? fechaLocal(presentacion) : (fechaInicial ?? fechaLocal()),
      hora: presentacion ? hora(presentacion) : '',
      anticipacion: presentacion
        ? String(Math.round((presentacion - new Date(viaje.hora_asignacion)) / 60000))
        : String(ANTICIPACION_POR_DEFECTO),
    }
  })
  // Links, ubicaciones, fotos, audios y archivos pegados al origen, al destino o a las observaciones (22/10/2026).
  const [adjuntos, setAdjuntos] = useState(viaje?.adjuntos ?? inicial?.adjuntos ?? [])
  // Choferes a los que no se les ofrece (26/10/2026).
  const [excluidos, setExcluidos] = useState(viaje?.choferes_excluidos ?? [])
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [confirmandoAnular, setConfirmandoAnular] = useState(false)
  // Con chofer, el selector es para pasárselo a otro: arranca vacío (2/11/2026).
  const [choferElegido, setChoferElegido] = useState(viaje?.chofer_id ? '' : viaje?.chofer_fijo ?? '')
  const [confirmandoCola, setConfirmandoCola] = useState(false)
  const choferes = useChoferesParaAsignar()
  const cambiar = (campo) => (e) => setDatos({ ...datos, [campo]: e.target.value })
  const sePuedeAnular = !esNuevo && ['sin_chofer', 'ofrecido', 'asignado'].includes(viaje.estado)
  // Viaje con chofer (ofrecido, aceptado o en curso): los cambios, la anulación o pasárselo a otro se le avisan.
  const conChofer = !esNuevo && !!viaje.chofer_id && !!viaje.chofer && ['ofrecido', 'asignado'].includes(viaje.estado)
  const sePuedePriorizar = !esNuevo && (viaje.estado === 'sin_chofer' || (viaje.estado === 'ofrecido' && !viaje.asignado_por))

  const [corrigiendoPago, setCorrigiendoPago] = useState(false)
  const hecho = !esNuevo && ['pago_pendiente', 'finalizado'].includes(viaje.estado)

  // Viaje nuevo que se repite (decidido el 15/10/2026): 'no' | 'sueltos' (días elegidos) | 'semanal' (con desde/hasta).
  // Se guarda como una serie (tabla viajes_fijos) y el servidor carga cada viaje.
  const [repetir, setRepetir] = useState('no')
  const [fechasSueltas, setFechasSueltas] = useState([])
  const [semana, setSemana] = useState({ dias: [], desde: '', hasta: '' })
  // Viaje de una serie: al guardar o anular se pregunta si es solo este o todos los que faltan.
  const [serie, setSerie] = useState(null)
  const [preguntaSerie, setPreguntaSerie] = useState(null) // la fila a guardar mientras se pregunta
  const deUnaSerie = !esNuevo && !!viaje.viaje_fijo_id && sePuedeAnular
  useEffect(() => {
    if (!viaje?.viaje_fijo_id) return
    supabase.from('viajes_fijos').select('*').eq('id', viaje.viaje_fijo_id).maybeSingle().then(({ data }) => setSerie(data))
  }, [viaje?.viaje_fijo_id])

  // El botón atrás del celular hace lo mismo que "Volver" en lo que se abre dentro del viaje.
  useAtras(corrigiendoPago, () => setCorrigiendoPago(false))
  useAtras(!!preguntaSerie, () => setPreguntaSerie(null))
  useAtras(confirmandoAnular, () => setConfirmandoAnular(false))
  useAtras(confirmandoCola, () => setConfirmandoCola(false))

  // Sin botón "No" (27/10/2026): tocar el modo elegido lo desmarca y vuelve a un solo viaje.
  function elegirRepetir(modo) {
    if (modo === repetir) return setRepetir('no')
    setRepetir(modo)
    if (modo === 'sueltos' && fechasSueltas.length === 0 && datos.fecha >= fechaLocal()) setFechasSueltas([datos.fecha])
    if (modo === 'semanal' && semana.dias.length === 0) {
      setSemana({ dias: [deFechaLocal(datos.fecha).getDay()], desde: datos.fecha, hasta: '' })
    }
  }

  function alternarDiaSemana(d) {
    setSemana({ ...semana, dias: semana.dias.includes(d) ? semana.dias.filter((x) => x !== d) : [...semana.dias, d] })
  }

  async function corregirPago(importe, forma_pago, cuenta, otro, extras) {
    const { error } = await supabase.rpc('corregir_pago', { viaje: viaje.id, importe, forma_pago, cuenta, otro, ...extras })
    if (error) return 'No se pudo guardar: ' + error.message
    onListo()
  }

  async function cambiarPrioridad() {
    setError('')
    const { error } = await supabase.from('viajes').update({ prioritario: !viaje.prioritario }).eq('id', viaje.id)
    if (error) setError('No se pudo cambiar la prioridad: ' + error.message)
    else onListo()
  }

  // Asignar, cambiar o sacar el chofer de un viaje ya cargado.
  async function guardarChofer() {
    setError('')
    setEnviando(true)
    const { error } = await supabase.rpc('asignar_viaje', { viaje: viaje.id, chofer: choferElegido || null })
    setEnviando(false)
    if (error) setError('No se pudo cambiar el chofer: ' + error.message)
    else onListo()
  }

  // Sacarle el viaje al chofer (aunque lo esté haciendo) y ofrecerlo a la cola, como prioritario (2/11/2026).
  async function mandarALaCola() {
    setError('')
    setEnviando(true)
    const { error } = await supabase.rpc('mandar_a_la_cola', { p_viaje: viaje.id })
    setEnviando(false)
    if (error) setError('No se pudo mandar a la cola: ' + error.message)
    else onListo()
  }

  // funcion: 'anular_viaje' (solo este) o 'anular_serie' (este y los que siguen de la serie).
  async function anular(funcion = 'anular_viaje') {
    setError('')
    setEnviando(true)
    const { error } = await supabase.rpc(funcion, { viaje: viaje.id })
    setEnviando(false)
    if (error) setError('No se pudo eliminar: ' + error.message)
    else onListo()
  }

  const esProgramado = datos.tipo === 'programado'
  const minutos = Number(datos.anticipacion)
  const presentacion = esProgramado && datos.fecha && datos.hora ? unirFechaHora(datos.fecha, datos.hora) : null
  const asignacion = presentacion && Number.isFinite(minutos) ? new Date(presentacion - minutos * 60000) : null

  async function guardar(e) {
    e.preventDefault()
    setError('')
    if (esNuevo && esProgramado && repetir !== 'no') return guardarSerieNueva()
    if (esProgramado) {
      if (!presentacion) return setError('Falta la fecha u hora de presentación.')
      if (!Number.isInteger(minutos) || minutos < 0 || minutos > 24 * 60) {
        return setError('La anticipación tiene que ser un número de minutos (0 o más).')
      }
    }

    const fila = {
      tipo: datos.tipo,
      cliente_id: datos.cliente_id, // con el cliente, el viaje copia solo su cuenta corriente (SQL 050)
      cliente_nombre: datos.cliente_nombre.trim() || null,
      cliente_telefono: datos.cliente_telefono.trim() || null,
      origen: datos.origen.trim(),
      destino: datos.destino.trim() || null,
      observaciones: datos.observaciones.trim() || null,
      adjuntos,
      choferes_excluidos: excluidos,
      hora_presentacion: esProgramado ? presentacion.toISOString() : null,
    }
    if (esProgramado) fila.hora_asignacion = asignacion.toISOString()
    else if (esNuevo || viaje.tipo === 'programado') fila.hora_asignacion = new Date().toISOString()

    // Regla D: chofer elegido al cargar el viaje. Se carga "en espera de gestión" (para que la
    // cola no lo tome) y enseguida se le asigna a ese chofer, que lo tiene que aceptar.
    if (esNuevo && choferElegido) fila.espera_gestion = true

    if (deUnaSerie) return setPreguntaSerie(fila) // "¿solo este o todos los que faltan?"
    await guardarFila(fila)
  }

  async function guardarFila(fila) {
    setError('')
    setEnviando(true)
    let error
    if (esNuevo) {
      const r = await supabase.from('viajes').insert(fila).select('id').single()
      error = r.error
      if (!error && choferElegido) {
        error = (await supabase.rpc('asignar_viaje', { viaje: r.data.id, chofer: choferElegido })).error
      }
    } else {
      error = (await supabase.from('viajes').update(fila).eq('id', viaje.id)).error
    }
    setEnviando(false)
    if (error) setError('No se pudo guardar: ' + error.message)
    else onListo()
  }

  // Viaje nuevo que se repite: se guarda la serie y el servidor carga los viajes.
  // Con chofer elegido, a cada viaje se le ofrece a ese chofer 7 días antes (como un viaje fijo con chofer fijo).
  async function guardarSerieNueva() {
    const hoy = fechaLocal()
    if (!datos.hora) return setError('Falta la hora de presentación.')
    if (!Number.isInteger(minutos) || minutos < 0 || minutos > 24 * 60) {
      return setError('La anticipación tiene que ser un número de minutos (0 o más).')
    }
    const base = {
      hora: datos.hora,
      anticipacion: minutos,
      origen: datos.origen.trim(),
      destino: datos.destino.trim() || null,
      cliente_id: datos.cliente_id,
      cliente_nombre: datos.cliente_nombre.trim() || null,
      cliente_telefono: datos.cliente_telefono.trim() || null,
      observaciones: datos.observaciones.trim() || null,
      adjuntos,
      choferes_excluidos: excluidos,
      chofer_id: choferElegido || null,
    }
    let fila
    if (repetir === 'sueltos') {
      if (fechasSueltas.length === 0) return setError('Tocá en el calendario los días del viaje.')
      if (fechasSueltas[0] < hoy) return setError('Elegiste un día que ya pasó.')
      if (fechasSueltas.includes(hoy) && unirFechaHora(hoy, datos.hora) <= new Date()) {
        return setError('Para hoy, esa hora ya pasó. Sacá el día de hoy o cambiá la hora.')
      }
      fila = { ...base, dias: [], fechas: fechasSueltas, desde: fechasSueltas[0] }
    } else {
      if (semana.dias.length === 0) return setError('Elegí los días de la semana.')
      if (!semana.desde) return setError('Falta la fecha "desde".')
      if (semana.hasta && semana.hasta < semana.desde) {
        return setError('La fecha "hasta" tiene que ser igual o posterior a "desde".')
      }
      fila = { ...base, dias: semana.dias.slice().sort(), desde: semana.desde, hasta: semana.hasta || null }
    }
    setEnviando(true)
    const { error } = await supabase.from('viajes_fijos').insert(fila)
    setEnviando(false)
    if (error) setError('No se pudo guardar: ' + error.message)
    else onListo()
  }

  // "Todos los que faltan": este viaje (por si ya salió, que a esos la serie no los toca) y la serie entera.
  async function guardarTodaLaSerie() {
    const fila = preguntaSerie
    setError('')
    setEnviando(true)
    let { error } = await supabase.from('viajes').update(fila).eq('id', viaje.id)
    if (!error) {
      ({ error } = await supabase.rpc('cambiar_serie', {
        viaje: viaje.id, p_hora: datos.hora, p_anticipacion: minutos, p_origen: fila.origen, p_destino: fila.destino,
        p_cliente_nombre: fila.cliente_nombre, p_cliente_telefono: fila.cliente_telefono, p_observaciones: fila.observaciones,
        p_adjuntos: fila.adjuntos, p_excluidos: fila.choferes_excluidos, p_cliente_id: fila.cliente_id ?? 0, // 0 = sin cliente
      }))
    }
    setEnviando(false)
    if (error) setError('No se pudo guardar: ' + error.message)
    else onListo()
  }
  // Cambiar la fecha o pasarlo a inmediato es solo para este viaje.
  const cambioLaFecha = !esNuevo && !!viaje.hora_presentacion && datos.fecha !== fechaLocal(new Date(viaje.hora_presentacion))
  const puedeCambiarTodos = esProgramado && !cambioLaFecha

  return (
    <main className="pantalla">
      <h1>{esNuevo ? 'Nuevo viaje' : `Viaje #${viaje.id}`}</h1>
      {!esNuevo && (
        <p className="ayuda">
          Estado: <strong>{NOMBRE_ESTADO_VIAJE[viaje.estado]}</strong>
          {viaje.chofer?.nombre && <> · Chofer: <strong>{viaje.chofer.nombre}</strong></>}
        </p>
      )}
      {!esNuevo && viaje.viaje_fijo_id && (
        <p className="aviso">
          🔁 Este viaje se repite{serie && <>: <strong>{textoSerie(serie)}</strong></>}.
          {deUnaSerie && ' Al guardar cambios o eliminarlo, te pregunto si es solo este o todos los que faltan.'}
        </p>
      )}
      <form className="tarjeta formulario-apretado" onSubmit={guardar}>
        <div className="selector-tipo">
          <button type="button" className={datos.tipo === 'inmediato' ? 'activo' : ''}
            onClick={() => setDatos({ ...datos, tipo: 'inmediato' })}>⚡ Inmediato</button>
          <button type="button" className={datos.tipo === 'programado' ? 'activo' : ''}
            onClick={() => setDatos({ ...datos, tipo: 'programado' })}>📅 Programado</button>
        </div>

        {esProgramado && (
          <div className="bloque-programado">
            {esNuevo && (
              <div>
                <p className="etiqueta-campo">Repetir</p>
                <div className="selector-tipo">
                  <button type="button" className={repetir === 'sueltos' ? 'activo' : ''}
                    onClick={() => elegirRepetir('sueltos')}>Días sueltos</button>
                  <button type="button" className={repetir === 'semanal' ? 'activo' : ''}
                    onClick={() => elegirRepetir('semanal')}>Todas las semanas</button>
                </div>
              </div>
            )}
            {repetir === 'sueltos' && (
              <>
                <small className="ayuda sin-margen">Tocá los días del viaje (se marcan en negro).</small>
                <ElegirFechas fechas={fechasSueltas} onCambiar={setFechasSueltas} />
                {fechasSueltas.length > 0 && (
                  <p className="resumen-serie">
                    Se {fechasSueltas.length === 1 ? 'carga 1 viaje' : `cargan ${fechasSueltas.length} viajes`}: {textoFechas(fechasSueltas)}
                  </p>
                )}
              </>
            )}
            {repetir === 'semanal' && (
              <>
                <div className="dias-semana">
                  {SEMANA.map(([d, texto]) => (
                    <button key={d} type="button" className={semana.dias.includes(d) ? 'activo' : ''}
                      onClick={() => alternarDiaSemana(d)}>{texto}</button>
                  ))}
                </div>
                <div className="dos-columnas">
                  <label>Desde<input type="date" value={semana.desde} min={fechaLocal()}
                    onChange={(e) => setSemana({ ...semana, desde: e.target.value })} /></label>
                  <label>Hasta (opcional)<input type="date" value={semana.hasta} min={semana.desde}
                    onChange={(e) => setSemana({ ...semana, hasta: e.target.value })} /></label>
                </div>
                {semana.dias.length > 0 && (
                  <p className="resumen-serie">
                    {textoSerie({ dias: semana.dias, desde: semana.desde, hasta: semana.hasta })}
                    {!semana.hasta && ' (sin fecha de fin)'}
                  </p>
                )}
              </>
            )}
            <div className="dos-columnas">
              {repetir === 'no' && <label>Fecha<input type="date" value={datos.fecha} onChange={cambiar('fecha')} required /></label>}
              <label>Hora de presentación<ElegirHora valor={datos.hora} onCambiar={(hora) => setDatos({ ...datos, hora })} /></label>
            </div>
            <label>
              Minutos antes para asignar
              <input inputMode="numeric" value={datos.anticipacion} onChange={cambiar('anticipacion')} />
            </label>
            <div className="botones-rapidos">
              {ANTICIPACIONES_RAPIDAS.map((m) => (
                <button key={m} type="button" className={minutos === m ? 'activo' : ''}
                  onClick={() => setDatos({ ...datos, anticipacion: String(m) })}>{m} min</button>
              ))}
            </div>
            {asignacion && repetir === 'no' && (
              <p className="aviso sin-margen">
                El chofer se asigna a las <strong>{hora(asignacion)}</strong>
                {fechaLocal(asignacion) !== fechaLocal(presentacion) && ' (del día anterior)'}.
              </p>
            )}
            {repetir !== 'no' && Number.isInteger(minutos) && (
              <p className="aviso sin-margen">En cada viaje, el chofer se asigna <strong>{minutos} minutos antes</strong>.</p>
            )}
          </div>
        )}

        {/* El cliente va antes del origen: al elegirlo, sus viajes de siempre llenan origen y destino (2/11/2026). */}
        <ElegirCliente datos={datos} onCambiar={(cambios) => setDatos((d) => ({ ...d, ...cambios }))} />
        <CampoConAdjuntos etiqueta="Origen (dirección de búsqueda)" campo="origen" adjuntos={adjuntos} onCambiar={setAdjuntos}>
          <input value={datos.origen} onChange={cambiar('origen')} required />
        </CampoConAdjuntos>
        <CampoConAdjuntos etiqueta="Destino" campo="destino" adjuntos={adjuntos} onCambiar={setAdjuntos}>
          <input value={datos.destino} onChange={cambiar('destino')} />
        </CampoConAdjuntos>
        <CampoConAdjuntos etiqueta="Observaciones" campo="observaciones" adjuntos={adjuntos} onCambiar={setAdjuntos}>
          <textarea rows={3} value={datos.observaciones} onChange={cambiar('observaciones')}
            placeholder="ej: con espera, ida y vuelta, lleva valija…" />
        </CampoConAdjuntos>
        {esNuevo && (
          <label>
            Chofer (opcional)
            <ElegirChofer valor={choferElegido} onCambiar={setChoferElegido} choferes={choferes} excluidos={excluidos} />
            <small className="ayuda">
              Solo si el cliente pidió un chofer en particular. Si no, se asigna solo.
              {esProgramado && repetir !== 'no' && ' Como se repite, cada viaje se le ofrece a este chofer 7 días antes y lo tiene que aceptar.'}
            </small>
          </label>
        )}

        {/* Chofer de un viaje ya cargado: en el mismo lugar que "Chofer (opcional)" al crearlo (26/10/2026). */}
        {sePuedeAnular && (
          <div className="chofer-del-viaje">
            <p className="sin-margen">{textoSituacion(viaje)}</p>
            {['no_salio', 'sin_aceptar'].includes(problemaDelViaje(viaje)) && viaje.chofer?.telefono && (
              <a className="boton secundario" href={'tel:' + viaje.chofer.telefono}>📞 Llamar a {viaje.chofer.nombre}</a>
            )}
            {sePuedePriorizar && (
              <button type="button" className="boton secundario" onClick={cambiarPrioridad}>
                {viaje.prioritario ? 'Quitar prioridad' : '⭐ Priorizar (se asigna antes que los demás)'}
              </button>
            )}
            {/* Con chofer (aunque ya lo esté haciendo): pasárselo a otro o mandarlo a la cola (2/11/2026). */}
            <label>
              {conChofer ? 'Pasárselo a otro chofer' : 'Chofer'}
              <ElegirChofer valor={choferElegido} onCambiar={setChoferElegido} excluidos={excluidos}
                choferes={conChofer ? choferes.filter((c) => c.id !== viaje.chofer_id) : choferes}
                textoVacio={conChofer ? 'Elegí el chofer…' : 'Sin chofer (vuelve a la asignación automática)'} />
            </label>
            <button type="button" className="boton"
              disabled={enviando
                || (conChofer ? !choferElegido : choferElegido === (viaje.chofer_id ?? '') && !viaje.espera_gestion)
                || (!!viaje.chofer_fijo && choferElegido === viaje.chofer_fijo)}
              onClick={guardarChofer}>
              {choferElegido || conChofer ? 'Asignar a este chofer'
                : viaje.espera_gestion ? 'Pasar a asignación automática' : 'Dejar sin chofer'}
            </button>
            {conChofer && choferElegido && (
              <small className="ayuda">
                A {viaje.chofer.nombre} le llega el aviso "Se anuló tu viaje"
                {viaje.iniciado_en && ' y, si no está haciendo otro viaje, vuelve al puesto 1 de la cola'}.
              </small>
            )}
            {conChofer && !confirmandoCola && (
              <button type="button" className="boton azul-oscuro" onClick={() => setConfirmandoCola(true)}>
                ↩️ Mandar a la cola
              </button>
            )}
            {conChofer && confirmandoCola && (
              <>
                <p className="sin-margen">
                  ¿Le sacás el viaje a <strong>{viaje.chofer.nombre}</strong> y lo mandás a la cola? Se le ofrece al primero
                  de la cola antes que los otros viajes (queda ⭐ prioritario). A {viaje.chofer.nombre} le llega "Se anuló
                  tu viaje"{viaje.iniciado_en && ' y, si no está haciendo otro viaje, vuelve al puesto 1 de la cola'}. Este
                  viaje no se le vuelve a ofrecer.
                </p>
                <button type="button" className="boton azul-oscuro" disabled={enviando} onClick={mandarALaCola}>
                  Sí, mandarlo a la cola
                </button>
                <button type="button" className="boton secundario" onClick={() => setConfirmandoCola(false)}>No</button>
              </>
            )}
          </div>
        )}
        {/* "No ofrecer a", abajo de la asignación del chofer (27/10/2026). */}
        <ElegirExcluidos choferes={choferes.map((c) => ({ id: c.id, nombre: c.perfiles.nombre }))}
          excluidos={excluidos} onCambiar={setExcluidos} />
        {error && <p className="aviso error">{error}</p>}
        {preguntaSerie ? (
          <div className="botonera">
            <p className="sin-margen"><strong>Este viaje se repite.</strong> ¿Qué querés cambiar?</p>
            <button type="button" className="boton" disabled={enviando} onClick={() => guardarFila(preguntaSerie)}>
              Solo este viaje
            </button>
            {puedeCambiarTodos ? (
              <button type="button" className="boton" disabled={enviando} onClick={guardarTodaLaSerie}>
                Todos los que faltan
              </button>
            ) : (
              <small className="ayuda">
                {esProgramado ? 'Cambiaste la fecha' : 'Lo pasaste a inmediato'}: eso se puede hacer solo para este viaje.
              </small>
            )}
            <button type="button" className="boton secundario" onClick={() => setPreguntaSerie(null)}>Volver</button>
          </div>
        ) : (
          <>
            <button className="boton" disabled={enviando}>
              {enviando ? 'Guardando…' : !esNuevo ? 'Guardar cambios'
                : esProgramado && repetir !== 'no' ? 'Cargar viajes' : 'Cargar viaje'}
            </button>
            <button type="button" className="boton secundario" onClick={onVolver ?? onListo}>Volver</button>
          </>
        )}
      </form>

      {/* Debajo del viaje (26/10/2026): el link del pasajero, el recorrido, el pago, eliminar y el historial. */}
      {/* Link del pasajero: con chofer, o en los programados desde que se cargan (para mandarlo antes; 26/10/2026). */}
      {!esNuevo && ['sin_chofer', 'ofrecido', 'asignado'].includes(viaje.estado)
        && (viaje.chofer_id || viaje.tipo === 'programado') && <CompartirViaje viaje={viaje} />}

      {!esNuevo && viaje.iniciado_en && (
        <RecorridoViaje viajeId={viaje.id} enCurso={viaje.estado === 'asignado'} />
      )}

      {!esNuevo && viaje.estado === 'fallido' && (
        <div className="tarjeta separada">
          <p className="sin-margen">
            ❌ <strong>Fallido</strong>{viaje.chofer?.nombre && <> · {viaje.chofer.nombre}</>}<br />
            Motivo: {viaje.motivo_fallido || 'sin motivo'}
          </p>
        </div>
      )}

      {hecho && (
        <div className="tarjeta separada">
          <h2>Pago</h2>
          {viaje.estado === 'pago_pendiente'
            ? <p className="aviso sin-margen">⏳ {viaje.chofer?.nombre ?? 'El chofer'} todavía no cargó el pago.</p>
            : <p className="sin-margen">
                <strong className="importe">{dinero(totalCobrado(viaje))}</strong> · {FORMAS_PAGO[viaje.forma_pago]}
                {(viaje.cuenta?.nombre || viaje.cuenta_otro) && <>: <strong>{viaje.cuenta?.nombre ?? viaje.cuenta_otro}</strong></>}
                {(viaje.demora || viaje.peaje || viaje.nafta) && (
                  <small className="ayuda"><br />
                    Viaje {dinero(viaje.importe)}
                    {viaje.demora && <> + demora {dinero(viaje.demora)}</>}
                    {viaje.peaje && <> + peaje {dinero(viaje.peaje)}</>}
                    {viaje.nafta && <> · Nafta/gas que cargó: {dinero(viaje.nafta)}</>}
                  </small>
                )}
              </p>}
          {viaje.estado === 'finalizado' && <EstadoPlanilla viajeId={viaje.id} />}
          {viaje.estado === 'finalizado' && !corrigiendoPago && (
            <AprobacionPago viaje={viaje} esAdmin={esAdmin} onListo={onListo} />
          )}
          {corrigiendoPago && viaje.aprobado_en && (
            <p className="aviso sin-margen">Este pago está aprobado: si lo corregís, deja de estarlo y hay que volver a aprobarlo.</p>
          )}
          {corrigiendoPago ? (
            <FormPago importeInicial={viaje.importe} {...pagoSugerido(viaje)}
              {...(viaje.forma_pago && { formaInicial: viaje.forma_pago, cuentaInicial: viaje.cuenta_id })}
              otroInicial={viaje.cuenta_otro}
              demoraInicial={viaje.demora} peajeInicial={viaje.peaje} naftaInicial={viaje.nafta}
              textoBoton="Guardar (queda registrado)" onGuardar={corregirPago} onCancelar={() => setCorrigiendoPago(false)} />
          ) : (
            <button type="button" className="boton secundario" onClick={() => setCorrigiendoPago(true)}>
              {viaje.estado === 'pago_pendiente' ? 'Cargar el pago desde gestión' : 'Corregir el pago'}
            </button>
          )}
        </div>
      )}

      {sePuedeAnular && (
        <div className="tarjeta separada">
          {!confirmandoAnular ? (
            <button type="button" className="boton peligro" onClick={() => setConfirmandoAnular(true)}>Eliminar viaje</button>
          ) : (
            <>
              <p className="sin-margen">
                ¿Seguro que querés eliminar el viaje #{viaje.id}? Deja de verse en la lista (queda solo en el filtro
                "Eliminado").
                {viaje.iniciado_en && viaje.chofer?.nombre &&
                  <> <strong>{viaje.chofer.nombre}</strong> vuelve al puesto 1 de la cola.</>}
                {conChofer && <> A {viaje.chofer.nombre} le llega un aviso.</>}
              </p>
              {deUnaSerie ? (
                <>
                  <button type="button" className="boton peligro" disabled={enviando} onClick={() => anular()}>
                    Eliminar solo este viaje
                  </button>
                  <button type="button" className="boton peligro" disabled={enviando} onClick={() => anular('anular_serie')}>
                    Eliminar este y los que siguen
                  </button>
                </>
              ) : (
                <button type="button" className="boton peligro" disabled={enviando} onClick={() => anular()}>Sí, eliminar</button>
              )}
              <button type="button" className="boton secundario" onClick={() => setConfirmandoAnular(false)}>No, dejarlo</button>
            </>
          )}
        </div>
      )}

      {!esNuevo && <HistorialViaje viajeId={viaje.id} />}
    </main>
  )
}
