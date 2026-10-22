import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import ElegirFechas from './ElegirFechas.jsx'
import ElegirHora from './ElegirHora.jsx'
import { useAtras } from './atras.js'
import { EditarAdjuntos } from './Adjuntos.jsx'
import { deFechaLocal, fechaCorta, fechaLocal, recorridoDebajo, tituloViaje } from './viajes.js'

// Orden de la semana para mostrar (lunes primero). Valores: 0 = domingo … 6 = sábado.
export const SEMANA = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [0, 'Dom']]
const NOMBRE_DIA = { 0: 'domingos', 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábados' }
const ANTICIPACIONES_RAPIDAS = [10, 20, 30, 45]
const VACIO = {
  dias: [], hora: '', anticipacion: '30', origen: '', destino: '', cliente_nombre: '', cliente_telefono: '',
  observaciones: '', chofer_id: '', activo: true, desde: '', hasta: '', fechas: null,
}

// "jue 15/10, lun 19/10 y vie 23/10"
export function textoFechas(fechas) {
  const textos = fechas.map((f) => fechaCorta(deFechaLocal(f)))
  return textos.length > 1 ? textos.slice(0, -1).join(', ') + ' y ' + textos.at(-1) : textos[0]
}

// "Lunes y jueves · hasta el vie 23/10" o "Días sueltos: jue 15/10 y lun 19/10"
export function textoSerie(f) {
  if (f.fechas?.length) return 'Días sueltos: ' + textoFechas(f.fechas)
  return [
    textoDias(f.dias),
    f.desde > fechaLocal() && `desde el ${fechaCorta(deFechaLocal(f.desde))}`,
    f.hasta && `hasta el ${fechaCorta(deFechaLocal(f.hasta))}`,
  ].filter(Boolean).join(' · ')
}

// Ya pasó su último día (los días sueltos o el "hasta").
function serieTerminada(f) {
  const ultimo = f.fechas?.length ? f.fechas.at(-1) : f.hasta
  return !!ultimo && ultimo < fechaLocal()
}

// "Lunes y jueves", "Lunes, miércoles y viernes", "Todos los días"
export function textoDias(dias) {
  if (dias.length === 7) return 'Todos los días'
  if (dias.length === 5 && [1, 2, 3, 4, 5].every((d) => dias.includes(d))) return 'De lunes a viernes'
  const nombres = SEMANA.filter(([d]) => dias.includes(d)).map(([d]) => NOMBRE_DIA[d])
  const texto = nombres.length > 1 ? nombres.slice(0, -1).join(', ') + ' y ' + nombres.at(-1) : nombres[0]
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

const horaCorta = (h) => h?.slice(0, 5)

// Gestión: viajes que se repiten (todas las semanas, con o sin fecha de fin, o días sueltos). Se cargan desde
// "Nuevo viaje" → Repetir, o acá. El servidor crea solo los viajes (los de todas las semanas, de las próximas 4 semanas).
export default function ViajesFijos({ onVolver }) {
  const [lista, setLista] = useState(null)
  const [editando, setEditando] = useState(null) // null = lista; objeto = alta (sin id) o edición
  const [choferes, setChoferes] = useState([])

  async function cargar() {
    const { data } = await supabase.from('viajes_fijos').select('*, chofer:perfiles!viajes_fijos_chofer_id_fkey(nombre)')
      .order('activo', { ascending: false }).order('hora')
    setLista(data ?? [])
  }
  useEffect(() => {
    cargar()
    supabase.from('perfiles').select('id, nombre').eq('rol', 'chofer').eq('activo', true).order('nombre')
      .then(({ data }) => setChoferes(data ?? []))
  }, [])

  const volver = () => { setEditando(null); cargar() }
  useAtras(!!editando, volver) // el botón atrás del celular hace lo mismo que "Volver"

  if (editando) return <FormViajeFijo fijo={editando} choferes={choferes} onListo={volver} />

  return (
    <main className="pantalla">
      <h1>Viajes fijos</h1>
      <p className="ayuda">
        Viajes que se repiten: todas las semanas (con o sin fecha de fin) o días sueltos. También se cargan desde
        "Nuevo viaje" → Repetir. Los viajes se cargan solos y se ven en el calendario; al cambiar o anular uno, la app
        pregunta si es solo ese o todos los que faltan.
      </p>
      <button className="boton" onClick={() => setEditando({ ...VACIO, desde: fechaLocal() })}>+ Nuevo viaje fijo</button>
      <button className="boton secundario" onClick={onVolver}>Volver a los viajes</button>
      {lista === null && <p>Cargando…</p>}
      {lista?.length === 0 && <p className="ayuda separada">Todavía no hay viajes fijos.</p>}
      <ul className="lista">
        {lista?.map((f) => (
          <li key={f.id}>
            <button className={'fila' + (f.activo && !serieTerminada(f) ? '' : ' inactivo')} onClick={() => setEditando(f)}>
              <span>
                <strong>{f.fechas?.length ? '📅' : '🔁'} {tituloViaje(f)}</strong>
                {recorridoDebajo(f) && <small>{recorridoDebajo(f)}</small>}
                <small>{horaCorta(f.hora)} · {textoSerie(f)}</small>
                {f.chofer && <small>📌 {f.chofer.nombre}</small>}
              </span>
              {!f.activo ? <span className="etiqueta">Pausado</span>
                : serieTerminada(f) && <span className="etiqueta">Terminado</span>}
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}

function FormViajeFijo({ fijo, choferes, onListo }) {
  const esNuevo = !fijo.id
  const [datos, setDatos] = useState(() => ({
    ...VACIO, ...fijo,
    hora: horaCorta(fijo.hora) ?? '',
    anticipacion: String(fijo.anticipacion ?? 30),
    ...Object.fromEntries(['destino', 'cliente_nombre', 'cliente_telefono', 'observaciones', 'chofer_id', 'hasta']
      .map((c) => [c, fijo[c] ?? ''])),
    desde: fijo.desde || fechaLocal(),
    fechas: fijo.fechas ?? null, // días sueltos
  }))
  // Lo que se adjunta acá queda en todos los viajes del viaje fijo (decidido el 22/10/2026).
  const [adjuntos, setAdjuntos] = useState(fijo.adjuntos ?? [])
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [confirmandoBorrar, setConfirmandoBorrar] = useState(false)
  const cambiar = (campo) => (e) => setDatos({ ...datos, [campo]: e.target.value })
  const minutos = Number(datos.anticipacion)

  function alternarDia(d) {
    setDatos({ ...datos, dias: datos.dias.includes(d) ? datos.dias.filter((x) => x !== d) : [...datos.dias, d] })
  }

  async function guardar(e, cambios = {}) {
    e?.preventDefault()
    setError('')
    const sueltos = !!datos.fechas
    const fila = {
      dias: sueltos ? [] : datos.dias.slice().sort(),
      fechas: sueltos ? datos.fechas : null,
      desde: sueltos ? datos.fechas[0] : datos.desde,
      hasta: sueltos ? null : datos.hasta || null,
      hora: datos.hora,
      anticipacion: minutos,
      origen: datos.origen.trim(),
      destino: datos.destino.trim() || null,
      cliente_nombre: datos.cliente_nombre.trim() || null,
      cliente_telefono: datos.cliente_telefono.trim() || null,
      observaciones: datos.observaciones.trim() || null,
      adjuntos,
      chofer_id: datos.chofer_id || null,
      activo: datos.activo,
      ...cambios,
    }
    if (sueltos ? !fila.fechas?.length : fila.dias.length === 0) return setError('Elegí al menos un día.')
    if (!sueltos && !fila.desde) return setError('Falta la fecha "desde".')
    if (fila.hasta && fila.hasta < fila.desde) return setError('La fecha "hasta" tiene que ser igual o posterior a "desde".')
    if (!fila.hora) return setError('Falta la hora de presentación.')
    if (!Number.isInteger(minutos) || minutos < 0 || minutos > 24 * 60) {
      return setError('La anticipación tiene que ser un número de minutos (0 o más).')
    }
    setEnviando(true)
    const { error } = esNuevo
      ? await supabase.from('viajes_fijos').insert(fila)
      : await supabase.from('viajes_fijos').update(fila).eq('id', fijo.id)
    setEnviando(false)
    if (error) setError('No se pudo guardar: ' + error.message)
    else onListo()
  }

  async function borrar() {
    setEnviando(true)
    const { error } = await supabase.from('viajes_fijos').delete().eq('id', fijo.id)
    setEnviando(false)
    if (error) setError('No se pudo borrar: ' + error.message)
    else onListo()
  }

  return (
    <main className="pantalla">
      <h1>{esNuevo ? 'Nuevo viaje fijo' : datos.fechas ? 'Viaje en días sueltos' : 'Viaje fijo'}</h1>
      {!esNuevo && !fijo.activo && <p className="aviso">⏸️ Pausado: no se están cargando viajes.</p>}
      <form className="tarjeta" onSubmit={guardar}>
        {datos.fechas ? (
          <div>
            <p className="etiqueta-campo">Días (tocá para marcar o desmarcar)</p>
            <ElegirFechas fechas={datos.fechas} onCambiar={(fechas) => setDatos({ ...datos, fechas })} />
          </div>
        ) : (
          <>
            <div>
              <p className="etiqueta-campo">Días</p>
              <div className="dias-semana">
                {SEMANA.map(([d, texto]) => (
                  <button key={d} type="button" className={datos.dias.includes(d) ? 'activo' : ''}
                    onClick={() => alternarDia(d)}>{texto}</button>
                ))}
              </div>
            </div>
            <div className="dos-columnas">
              <label>Desde<input type="date" value={datos.desde} onChange={cambiar('desde')} /></label>
              <label>Hasta (opcional)<input type="date" value={datos.hasta} min={datos.desde} onChange={cambiar('hasta')} /></label>
            </div>
            <small className="ayuda sin-margen">Sin "hasta", se repite siempre (hasta que lo pausés o lo borrés).</small>
          </>
        )}
        <div className="dos-columnas">
          <label>Hora de presentación<ElegirHora valor={datos.hora} onCambiar={(hora) => setDatos({ ...datos, hora })} /></label>
          <label>Minutos para asignar<input inputMode="numeric" value={datos.anticipacion} onChange={cambiar('anticipacion')} /></label>
        </div>
        <div className="botones-rapidos">
          {ANTICIPACIONES_RAPIDAS.map((m) => (
            <button key={m} type="button" className={minutos === m ? 'activo' : ''}
              onClick={() => setDatos({ ...datos, anticipacion: String(m) })}>{m} min</button>
          ))}
        </div>

        <div className="campo-con-adjuntos">
          <label>Origen (dirección de búsqueda)<input value={datos.origen} onChange={cambiar('origen')} required /></label>
          <EditarAdjuntos campo="origen" adjuntos={adjuntos} onCambiar={setAdjuntos} />
        </div>
        <div className="campo-con-adjuntos">
          <label>Destino<input value={datos.destino} onChange={cambiar('destino')} /></label>
          <EditarAdjuntos campo="destino" adjuntos={adjuntos} onCambiar={setAdjuntos} />
        </div>
        <label>Cliente<input value={datos.cliente_nombre} onChange={cambiar('cliente_nombre')} /></label>
        <label>Teléfono del cliente<input type="tel" value={datos.cliente_telefono} onChange={cambiar('cliente_telefono')} /></label>
        <div className="campo-con-adjuntos">
          <label>
            Observaciones
            <textarea rows={2} value={datos.observaciones} onChange={cambiar('observaciones')} />
          </label>
          <EditarAdjuntos campo="observaciones" adjuntos={adjuntos} onCambiar={setAdjuntos} />
        </div>
        <label>
          Chofer fijo (opcional)
          <select value={datos.chofer_id} onChange={cambiar('chofer_id')}>
            <option value="">Sin chofer fijo (se asigna por la cola)</option>
            {choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <small className="ayuda">Con chofer fijo, cada viaje se le ofrece 7 días antes y lo tiene que aceptar.</small>
        </label>

        {!esNuevo && (
          <p className="ayuda sin-margen">
            Al guardar, los viajes de las próximas semanas se actualizan, salvo los días que cambiaste o anulaste a mano. Si alguno ya se lo habían asignado a un chofer, le llega un aviso del cambio.
          </p>
        )}
        {error && <p className="aviso error">{error}</p>}
        <button className="boton" disabled={enviando}>{enviando ? 'Guardando…' : esNuevo ? 'Cargar viaje fijo' : 'Guardar cambios'}</button>
        <button type="button" className="boton secundario" onClick={onListo}>Volver</button>
      </form>

      {!esNuevo && (
        <div className="tarjeta separada">
          <button type="button" className="boton secundario" disabled={enviando}
            onClick={() => guardar(null, { activo: !fijo.activo })}>
            {fijo.activo ? '⏸️ Pausar (deja de cargar viajes)' : '▶️ Reactivar'}
          </button>
          {!confirmandoBorrar ? (
            <button type="button" className="boton peligro" onClick={() => setConfirmandoBorrar(true)}>Borrar viaje fijo</button>
          ) : (
            <>
              <p className="sin-margen">
                ¿Seguro? Se borran los viajes de las próximas semanas que todavía no se ofrecieron a ningún chofer
                (los que ya se ofrecieron quedan anulados). Los viajes ya hechos quedan en el historial.
              </p>
              <button type="button" className="boton peligro" disabled={enviando} onClick={borrar}>Sí, borrar</button>
              <button type="button" className="boton secundario" onClick={() => setConfirmandoBorrar(false)}>No</button>
            </>
          )}
        </div>
      )}
    </main>
  )
}
