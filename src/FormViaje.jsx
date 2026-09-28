import { useState } from 'react'
import { supabase } from './supabase.js'
import { NOMBRE_ESTADO_VIAJE, fechaLocal, hora, unirFechaHora } from './viajes.js'

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
  const cambiar = (campo) => (e) => setDatos({ ...datos, [campo]: e.target.value })
  const sePuedeAnular = !esNuevo && ['sin_chofer', 'asignado'].includes(viaje.estado)

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

    setEnviando(true)
    const { error } = esNuevo
      ? await supabase.from('viajes').insert(fila)
      : await supabase.from('viajes').update(fila).eq('id', viaje.id)
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

        {error && <p className="aviso error">{error}</p>}
        <button className="boton" disabled={enviando}>
          {enviando ? 'Guardando…' : esNuevo ? 'Cargar viaje' : 'Guardar cambios'}
        </button>
        <button type="button" className="boton secundario" onClick={onListo}>Volver</button>
      </form>

      {sePuedeAnular && (
        <div className="tarjeta separada">
          {!confirmandoAnular ? (
            <button type="button" className="boton peligro" onClick={() => setConfirmandoAnular(true)}>Anular viaje</button>
          ) : (
            <>
              <p className="sin-margen">
                ¿Seguro que querés anular el viaje #{viaje.id}?
                {viaje.estado === 'asignado' && viaje.chofer?.nombre &&
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
