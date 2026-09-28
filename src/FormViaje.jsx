import { useState } from 'react'
import { supabase } from './supabase.js'
import { NOMBRE_ESTADO_VIAJE, fechaLocal, hora, unirFechaHora } from './viajes.js'
import ElegirChofer, { useChoferesParaAsignar } from './ElegirChofer.jsx'
import FormPago from './FormPago.jsx'
import { FORMAS_PAGO, dinero } from './viajes.js'

// Explicación en palabras de en qué anda la asignación del viaje.
function textoSituacion(v) {
  const nombre = v.chofer?.nombre
  if (v.estado === 'sin_chofer' && v.espera_gestion) {
    return `❌ ${v.rechazo?.nombre ?? 'El chofer'} rechazó este viaje. No se asigna solo: elegí otro chofer o dejalo en automático.`
  }
  if (v.estado === 'sin_chofer') return 'Esperando chofer: se le ofrece al primero de la cola.'
  if (v.estado === 'ofrecido' && v.oferta_vence) return `Se le ofreció a ${nombre}. Tiene 3 minutos para aceptar.`
  if (v.estado === 'ofrecido') return `📌 Asignado a mano a ${nombre}. Esperando que lo acepte.`
  if (v.estado === 'asignado' && !v.iniciado_en) return `${nombre} lo aceptó. Todavía no salió a hacerlo.`
  if (v.estado === 'asignado') return `${nombre} está haciendo este viaje.`
  return ''
}

const ANTICIPACION_POR_DEFECTO = 30
const ANTICIPACIONES_RAPIDAS = [10, 20, 30, 45]

// Alta y edición de un viaje (gestión).
export default function FormViaje({ viaje, onListo }) {
  const esNuevo = !viaje
  const [datos, setDatos] = useState(() => {
    const presentacion = viaje?.hora_presentacion ? new Date(viaje.hora_presentacion) : null
    return {
      tipo: viaje?.tipo ?? 'inmediato',
      cliente_nombre: viaje?.cliente_nombre ?? '',
      cliente_telefono: viaje?.cliente_telefono ?? '',
      origen: viaje?.origen ?? '',
      destino: viaje?.destino ?? '',
      observaciones: viaje?.observaciones ?? '',
      fecha: presentacion ? fechaLocal(presentacion) : fechaLocal(),
      hora: presentacion ? hora(presentacion) : '',
      anticipacion: presentacion
        ? String(Math.round((presentacion - new Date(viaje.hora_asignacion)) / 60000))
        : String(ANTICIPACION_POR_DEFECTO),
    }
  })
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [confirmandoAnular, setConfirmandoAnular] = useState(false)
  const [choferElegido, setChoferElegido] = useState(viaje?.chofer_id ?? '')
  const choferes = useChoferesParaAsignar()
  const cambiar = (campo) => (e) => setDatos({ ...datos, [campo]: e.target.value })
  const sePuedeAnular = !esNuevo && ['sin_chofer', 'ofrecido', 'asignado'].includes(viaje.estado)
  const sePuedePriorizar = !esNuevo && (viaje.estado === 'sin_chofer' || (viaje.estado === 'ofrecido' && viaje.oferta_vence))

  const [corrigiendoPago, setCorrigiendoPago] = useState(false)
  const hecho = !esNuevo && ['pago_pendiente', 'finalizado'].includes(viaje.estado)

  async function corregirPago(importe, forma_pago, cuenta) {
    const { error } = await supabase.rpc('corregir_pago', { viaje: viaje.id, importe, forma_pago, cuenta })
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

  async function anular() {
    setError('')
    setEnviando(true)
    const { error } = await supabase.rpc('anular_viaje', { viaje: viaje.id })
    setEnviando(false)
    if (error) setError('No se pudo anular: ' + error.message)
    else onListo()
  }

  const esProgramado = datos.tipo === 'programado'
  const minutos = Number(datos.anticipacion)
  const presentacion = esProgramado && datos.fecha && datos.hora ? unirFechaHora(datos.fecha, datos.hora) : null
  const asignacion = presentacion && Number.isFinite(minutos) ? new Date(presentacion - minutos * 60000) : null

  async function guardar(e) {
    e.preventDefault()
    setError('')
    if (esProgramado) {
      if (!presentacion) return setError('Falta la fecha u hora de presentación.')
      if (!Number.isInteger(minutos) || minutos < 0 || minutos > 24 * 60) {
        return setError('La anticipación tiene que ser un número de minutos (0 o más).')
      }
    }

    const fila = {
      tipo: datos.tipo,
      cliente_nombre: datos.cliente_nombre.trim() || null,
      cliente_telefono: datos.cliente_telefono.trim() || null,
      origen: datos.origen.trim(),
      destino: datos.destino.trim() || null,
      observaciones: datos.observaciones.trim() || null,
      hora_presentacion: esProgramado ? presentacion.toISOString() : null,
    }
    if (esProgramado) fila.hora_asignacion = asignacion.toISOString()
    else if (esNuevo || viaje.tipo === 'programado') fila.hora_asignacion = new Date().toISOString()

    // Regla D: chofer elegido al cargar el viaje. Se carga "en espera de gestión" (para que la
    // cola no lo tome) y enseguida se le asigna a ese chofer, que lo tiene que aceptar.
    if (esNuevo && choferElegido) fila.espera_gestion = true

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

  return (
    <main className="pantalla">
      <h1>{esNuevo ? 'Nuevo viaje' : `Viaje #${viaje.id}`}</h1>
      {!esNuevo && (
        <p className="ayuda">
          Estado: <strong>{NOMBRE_ESTADO_VIAJE[viaje.estado]}</strong>
          {viaje.chofer?.nombre && <> · Chofer: <strong>{viaje.chofer.nombre}</strong></>}
        </p>
      )}
      <form className="tarjeta" onSubmit={guardar}>
        <div className="selector-tipo">
          <button type="button" className={datos.tipo === 'inmediato' ? 'activo' : ''}
            onClick={() => setDatos({ ...datos, tipo: 'inmediato' })}>⚡ Inmediato</button>
          <button type="button" className={datos.tipo === 'programado' ? 'activo' : ''}
            onClick={() => setDatos({ ...datos, tipo: 'programado' })}>📅 Programado</button>
        </div>

        {esProgramado && (
          <div className="bloque-programado">
            <div className="dos-columnas">
              <label>Fecha<input type="date" value={datos.fecha} onChange={cambiar('fecha')} required /></label>
              <label>Hora de presentación<input type="time" value={datos.hora} onChange={cambiar('hora')} required /></label>
            </div>
            <label>
              Minutos de anticipación para asignar el chofer
              <input inputMode="numeric" value={datos.anticipacion} onChange={cambiar('anticipacion')} />
            </label>
            <div className="botones-rapidos">
              {ANTICIPACIONES_RAPIDAS.map((m) => (
                <button key={m} type="button" className={minutos === m ? 'activo' : ''}
                  onClick={() => setDatos({ ...datos, anticipacion: String(m) })}>{m} min</button>
              ))}
            </div>
            {asignacion && (
              <p className="aviso sin-margen">
                El chofer se asigna a las <strong>{hora(asignacion)}</strong>
                {fechaLocal(asignacion) !== fechaLocal(presentacion) && ' (del día anterior)'}.
              </p>
            )}
          </div>
        )}

        <label>Origen (dirección de búsqueda)<input value={datos.origen} onChange={cambiar('origen')} required /></label>
        <label>Destino<input value={datos.destino} onChange={cambiar('destino')} /></label>
        <label>Cliente<input value={datos.cliente_nombre} onChange={cambiar('cliente_nombre')} /></label>
        <label>Teléfono del cliente<input type="tel" value={datos.cliente_telefono} onChange={cambiar('cliente_telefono')} /></label>
        <label>
          Observaciones
          <textarea rows={3} value={datos.observaciones} onChange={cambiar('observaciones')}
            placeholder="ej: con espera, ida y vuelta, lleva valija…" />
        </label>
        {esNuevo && (
          <label>
            Chofer (opcional)
            <ElegirChofer valor={choferElegido} onCambiar={setChoferElegido} choferes={choferes} />
            <small className="ayuda">Solo si el cliente pidió un chofer en particular. Si no, se asigna solo.</small>
          </label>
        )}

        {error && <p className="aviso error">{error}</p>}
        <button className="boton" disabled={enviando}>
          {enviando ? 'Guardando…' : esNuevo ? 'Cargar viaje' : 'Guardar cambios'}
        </button>
        <button type="button" className="boton secundario" onClick={onListo}>Volver</button>
      </form>

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
                <strong className="importe">{dinero(viaje.importe)}</strong> · {FORMAS_PAGO[viaje.forma_pago]}
                {viaje.cuenta?.nombre && <>: <strong>{viaje.cuenta.nombre}</strong></>}
              </p>}
          {corrigiendoPago ? (
            <FormPago importeInicial={viaje.importe} formaInicial={viaje.forma_pago} cuentaInicial={viaje.cuenta_id}
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
          <p className="sin-margen">{textoSituacion(viaje)}</p>
          {sePuedePriorizar && (
            <button type="button" className="boton secundario" onClick={cambiarPrioridad}>
              {viaje.prioritario ? 'Quitar prioridad' : '⭐ Priorizar (se asigna antes que los demás)'}
            </button>
          )}
          <label>
            Chofer
            <ElegirChofer valor={choferElegido} onCambiar={setChoferElegido} choferes={choferes}
              textoVacio="Sin chofer (vuelve a la asignación automática)" />
          </label>
          <button type="button" className="boton"
            disabled={enviando || (choferElegido === (viaje.chofer_id ?? '') && !viaje.espera_gestion)}
            onClick={guardarChofer}>
            {choferElegido ? 'Asignar a este chofer'
              : viaje.espera_gestion ? 'Pasar a asignación automática' : 'Dejar sin chofer'}
          </button>
        </div>
      )}

      {sePuedeAnular && (
        <div className="tarjeta separada">
          {!confirmandoAnular ? (
            <button type="button" className="boton peligro" onClick={() => setConfirmandoAnular(true)}>Anular viaje</button>
          ) : (
            <>
              <p className="sin-margen">
                ¿Seguro que querés anular el viaje #{viaje.id}?
                {viaje.iniciado_en && viaje.chofer?.nombre &&
                  <> <strong>{viaje.chofer.nombre}</strong> vuelve al puesto 1 de la cola.</>}
              </p>
              <button type="button" className="boton peligro" disabled={enviando} onClick={anular}>Sí, anular</button>
              <button type="button" className="boton secundario" onClick={() => setConfirmandoAnular(false)}>No, dejarlo</button>
            </>
          )}
        </div>
      )}
    </main>
  )
}
