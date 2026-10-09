import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { FORMAS_PAGO, dinero, leerImporte } from './viajes.js'

const textoInicial = (n) => (n === null || n === undefined ? '' : String(n))

// Importe + forma de pago (+ cuenta corriente si corresponde: una de la lista u "Otro" con el nombre).
// Además, como el formulario de la planilla: demora y peaje (se cobran aparte) y nafta (lo que cargó el chofer).
// onGuardar(importe, forma, cuenta, otro, { demora, peaje, nafta }) devuelve una promesa con el texto del error,
// o nada si salió bien.
export default function FormPago({
  importeInicial = '', formaInicial = '', cuentaInicial = null, otroInicial = '',
  demoraInicial = null, peajeInicial = null, naftaInicial = null,
  textoBoton = 'Guardar pago', onGuardar, onCancelar,
}) {
  const [importe, setImporte] = useState(textoInicial(importeInicial))
  const [forma, setForma] = useState(formaInicial ?? '')
  // id de la cuenta, 'otro' o '' (sin elegir)
  const [cuenta, setCuenta] = useState(cuentaInicial ? String(cuentaInicial) : otroInicial ? 'otro' : '')
  const [otro, setOtro] = useState(otroInicial ?? '')
  const [extras, setExtras] = useState({
    demora: textoInicial(demoraInicial), peaje: textoInicial(peajeInicial), nafta: textoInicial(naftaInicial),
  })
  const [verExtras, setVerExtras] = useState(!!(demoraInicial || peajeInicial || naftaInicial))
  const [cuentas, setCuentas] = useState([])
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    supabase.from('cuentas_corrientes').select('id, nombre').eq('activo', true).order('nombre')
      .then(({ data }) => setCuentas(data ?? []))
  }, [])

  const cambiarExtra = (campo) => (e) => setExtras({ ...extras, [campo]: e.target.value })
  // Vacío = no hubo (null); si escribió algo que no es un número, undefined.
  const leerExtra = (texto) => (texto.trim() === '' ? null : leerImporte(texto) ?? undefined)

  async function guardar() {
    setError('')
    const n = leerImporte(importe)
    if (n === null) return setError('Escribí el importe (solo números).')
    const demora = leerExtra(extras.demora), peaje = leerExtra(extras.peaje), nafta = leerExtra(extras.nafta)
    if (demora === undefined) return setError('La demora tiene que ser un número.')
    if (peaje === undefined) return setError('El peaje tiene que ser un número.')
    if (nafta === undefined) return setError('La nafta tiene que ser un número.')
    if (!forma) return setError('Elegí la forma de pago.')
    const esCuenta = forma === 'cuenta_corriente'
    if (esCuenta && !cuenta) return setError('Elegí a qué cuenta corriente va.')
    if (esCuenta && cuenta === 'otro' && !otro.trim()) return setError('Escribí el nombre del cliente.')
    setEnviando(true)
    const err = await onGuardar(n, forma,
      esCuenta && cuenta !== 'otro' ? Number(cuenta) : null,
      esCuenta && cuenta === 'otro' ? otro.trim() : null,
      { demora, peaje, nafta })
    setEnviando(false)
    if (err) setError(err)
  }

  // Lo que paga el pasajero en total (la nafta es un gasto del chofer, no se le cobra).
  const importeNum = leerImporte(importe) ?? 0
  const demoraNum = leerImporte(extras.demora) ?? 0
  const peajeNum = leerImporte(extras.peaje) ?? 0
  const total = importeNum + demoraNum + peajeNum

  return (
    <div className="form-pago">
      <label>
        Importe del viaje
        <input inputMode="decimal" placeholder="$" value={importe} onChange={(e) => setImporte(e.target.value)} />
      </label>
      {verExtras ? (
        <>
          <div className="extras-pago">
            <label>Demora<input inputMode="decimal" placeholder="$" value={extras.demora} onChange={cambiarExtra('demora')} /></label>
            <label>Peaje<input inputMode="decimal" placeholder="$" value={extras.peaje} onChange={cambiarExtra('peaje')} /></label>
            <label>Nafta/gas<input inputMode="decimal" placeholder="$" value={extras.nafta} onChange={cambiarExtra('nafta')} /></label>
          </div>
          <small className="ayuda sin-margen">
            Demora y peaje: lo que se cobró aparte. Nafta/gas: lo que cargaste, solo si corresponde.
            {(demoraNum > 0 || peajeNum > 0) && importeNum > 0 && <> Total que pagó el pasajero: <strong>{dinero(total)}</strong>.</>}
          </small>
        </>
      ) : (
        <button type="button" className="boton secundario" onClick={() => setVerExtras(true)}>
          + Agregar demora, peaje o nafta
        </button>
      )}
      <div className="formas-pago">
        {Object.entries(FORMAS_PAGO).map(([id, texto]) => (
          <button key={id} type="button" className={forma === id ? 'activo' : ''} onClick={() => setForma(id)}>{texto}</button>
        ))}
      </div>
      {forma === 'cuenta_corriente' && (
        <label>
          ¿A qué cuenta corriente?
          <select value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
            <option value="">Elegir…</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            <option value="otro">Otro (escribir el nombre)</option>
          </select>
        </label>
      )}
      {forma === 'cuenta_corriente' && cuenta === 'otro' && (
        <label>
          Nombre del cliente
          <input value={otro} onChange={(e) => setOtro(e.target.value)} placeholder="ej: Juan Pérez" />
        </label>
      )}
      {error && <p className="aviso error">{error}</p>}
      <button type="button" className="boton verde" disabled={enviando} onClick={guardar}>
        {enviando ? 'Guardando…' : textoBoton}
      </button>
      {onCancelar && <button type="button" className="boton secundario" onClick={onCancelar}>Volver</button>}
    </div>
  )
}
