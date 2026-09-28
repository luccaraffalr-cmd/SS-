import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { FORMAS_PAGO, leerImporte } from './viajes.js'

// Importe + forma de pago (+ cuenta corriente si corresponde: una de la lista u "Otro" con el nombre).
// onGuardar(importe, forma, cuenta, otro) devuelve una promesa con el texto del error, o nada si salió bien.
export default function FormPago({
  importeInicial = '', formaInicial = '', cuentaInicial = null, otroInicial = '',
  textoBoton = 'Guardar pago', onGuardar, onCancelar,
}) {
  const [importe, setImporte] = useState(importeInicial === null ? '' : String(importeInicial))
  const [forma, setForma] = useState(formaInicial ?? '')
  // id de la cuenta, 'otro' o '' (sin elegir)
  const [cuenta, setCuenta] = useState(cuentaInicial ? String(cuentaInicial) : otroInicial ? 'otro' : '')
  const [otro, setOtro] = useState(otroInicial ?? '')
  const [cuentas, setCuentas] = useState([])
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    supabase.from('cuentas_corrientes').select('id, nombre').eq('activo', true).order('nombre')
      .then(({ data }) => setCuentas(data ?? []))
  }, [])

  async function guardar() {
    setError('')
    const n = leerImporte(importe)
    if (n === null) return setError('Escribí el importe (solo números).')
    if (!forma) return setError('Elegí la forma de pago.')
    const esCuenta = forma === 'cuenta_corriente'
    if (esCuenta && !cuenta) return setError('Elegí a qué cuenta corriente va.')
    if (esCuenta && cuenta === 'otro' && !otro.trim()) return setError('Escribí el nombre del cliente.')
    setEnviando(true)
    const err = await onGuardar(n, forma,
      esCuenta && cuenta !== 'otro' ? Number(cuenta) : null,
      esCuenta && cuenta === 'otro' ? otro.trim() : null)
    setEnviando(false)
    if (err) setError(err)
  }

  return (
    <div className="form-pago">
      <label>
        Importe
        <input inputMode="decimal" placeholder="$" value={importe} onChange={(e) => setImporte(e.target.value)} />
      </label>
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
