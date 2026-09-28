import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { FORMAS_PAGO, leerImporte } from './viajes.js'

// Importe + forma de pago (+ cuenta corriente si corresponde).
// onGuardar(importe, forma, cuenta) devuelve una promesa con el texto del error, o nada si salió bien.
export default function FormPago({
  importeInicial = '', formaInicial = '', cuentaInicial = null,
  textoBoton = 'Guardar pago', onGuardar, onCancelar,
}) {
  const [importe, setImporte] = useState(importeInicial === null ? '' : String(importeInicial))
  const [forma, setForma] = useState(formaInicial ?? '')
  const [cuenta, setCuenta] = useState(cuentaInicial ? String(cuentaInicial) : '')
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
    if (forma === 'cuenta_corriente' && !cuenta) return setError('Elegí a qué cuenta corriente va.')
    setEnviando(true)
    const err = await onGuardar(n, forma, forma === 'cuenta_corriente' ? Number(cuenta) : null)
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
          </select>
          {cuentas.length === 0 && <small className="ayuda">Todavía no hay cuentas cargadas. Pedile al admin que la agregue.</small>}
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
