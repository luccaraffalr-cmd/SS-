import { useState } from 'react'
import { FORMAS_PAGO, leerImporte } from './viajes.js'

// Importe + forma de pago. onGuardar(importe, forma) devuelve una promesa.
export default function FormPago({ importeInicial = '', formaInicial = '', textoBoton = 'Guardar pago', onGuardar, onCancelar }) {
  const [importe, setImporte] = useState(importeInicial === null ? '' : String(importeInicial))
  const [forma, setForma] = useState(formaInicial ?? '')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function guardar() {
    setError('')
    const n = leerImporte(importe)
    if (n === null) return setError('Escribí el importe (solo números).')
    if (!forma) return setError('Elegí la forma de pago.')
    setEnviando(true)
    const err = await onGuardar(n, forma)
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
      {error && <p className="aviso error">{error}</p>}
      <button type="button" className="boton verde" disabled={enviando} onClick={guardar}>
        {enviando ? 'Guardando…' : textoBoton}
      </button>
      {onCancelar && <button type="button" className="boton secundario" onClick={onCancelar}>Volver</button>}
    </div>
  )
}
