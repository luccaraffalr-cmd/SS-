import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { CONSULTA_CLIENTES, buscarClientes, cantidadDeViajes, normalizar, telefonoParaWhatsApp, viajesDeSiempre } from './clientes.js'

// "23 viajes"
export const textoViajes = (n) => (n === 1 ? '1 viaje' : `${n} viajes`)

// Aviso abajo del teléfono si así no le va a llegar el WhatsApp (por ejemplo, sin código de área).
export function AvisoTelefono({ telefono }) {
  if (!telefono?.trim() || telefonoParaWhatsApp(telefono)) return null
  return <small className="ayuda texto-alerta">⚠️ Así no sirve para WhatsApp: escribilo con el código de área (ej: 11 5555-1234).</small>
}

// Cliente de un viaje o viaje fijo (2/11/2026): buscador de los clientes guardados (por nombre o teléfono, sin importar
// tildes ni mayúsculas). Al tocar uno se completan su teléfono y su nota fija, y aparecen sus viajes de siempre (al
// tocar uno se llenan origen y destino). Si no está guardado, el viaje se carga igual con el nombre escrito.
// datos: { cliente_id, cliente_nombre, cliente_telefono, origen, destino, observaciones }; onCambiar(cambios).
export default function ElegirCliente({ datos, onCambiar }) {
  const [clientes, setClientes] = useState(null)
  const [historial, setHistorial] = useState([]) // viajes del cliente elegido (para sus viajes de siempre)
  const [buscando, setBuscando] = useState(false) // las sugerencias aparecen recién al escribir o tocar el campo
  const elegido = clientes?.find((c) => c.id === datos.cliente_id)

  useEffect(() => {
    supabase.from('clientes').select(CONSULTA_CLIENTES).then(({ data }) => setClientes(data ?? []))
  }, [])
  useEffect(() => {
    if (!datos.cliente_id) return setHistorial([])
    supabase.from('viajes').select('origen, destino').eq('cliente_id', datos.cliente_id).neq('estado', 'anulado')
      .order('creado_en', { ascending: false }).limit(100)
      .then(({ data }) => setHistorial(data ?? []))
  }, [datos.cliente_id])

  const sugerencias = buscando && !datos.cliente_id && clientes ? buscarClientes(clientes, datos.cliente_nombre) : []
  const noEsta = buscando && !datos.cliente_id && clientes && normalizar(datos.cliente_nombre).length >= 2
    && sugerencias.length === 0
  const deSiempre = viajesDeSiempre(historial)

  function elegir(c) {
    setBuscando(false)
    const cambios = { cliente_id: c.id, cliente_nombre: c.nombre }
    if (c.telefono) cambios.cliente_telefono = c.telefono
    const nota = c.nota?.trim()
    if (nota && !datos.observaciones.includes(nota)) {
      cambios.observaciones = datos.observaciones.trim() ? datos.observaciones.trim() + '\n' + nota : nota
    }
    onCambiar(cambios)
  }

  // ✕: vuelve al buscador. Se saca lo que había puesto el cliente (su teléfono y su nota), si no lo cambiaron.
  function sacar() {
    const cambios = { cliente_id: null, cliente_nombre: '' }
    if (elegido?.telefono && datos.cliente_telefono === elegido.telefono) cambios.cliente_telefono = ''
    const nota = elegido?.nota?.trim()
    if (nota && datos.observaciones.includes(nota)) cambios.observaciones = datos.observaciones.replace(nota, '').trim()
    onCambiar(cambios)
    setBuscando(true)
  }

  const esEste = (r) => normalizar(r.origen) === normalizar(datos.origen) && normalizar(r.destino) === normalizar(datos.destino)

  return (
    <div className="elegir-cliente">
      {datos.cliente_id ? (
        <div>
          <p className="etiqueta-campo">Cliente</p>
          <div className="cliente-elegido">
            <span>👤 <strong>{datos.cliente_nombre || elegido?.nombre}</strong></span>
            <button type="button" onClick={sacar} aria-label="Sacar el cliente y buscar otro">✕</button>
          </div>
        </div>
      ) : (
        <label>
          Cliente
          <input value={datos.cliente_nombre} placeholder="Buscalo por nombre o teléfono" autoComplete="off"
            onFocus={() => setBuscando(true)}
            onChange={(e) => { setBuscando(true); onCambiar({ cliente_nombre: e.target.value }) }} />
        </label>
      )}
      {sugerencias.length > 0 && (
        <ul className="lista-elegir">
          {sugerencias.map((c) => (
            <li key={c.id}>
              <button type="button" className="opcion-viaje" onClick={() => elegir(c)}>
                <strong>👤 {c.nombre}</strong>
                <small>
                  {[c.telefono, textoViajes(cantidadDeViajes(c)), c.cuenta && `💳 ${c.cuenta.nombre}`].filter(Boolean).join(' · ')}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {noEsta && (
        <small className="ayuda">No está en Clientes: el viaje se carga igual. Para guardarlo: pestaña Clientes → ➕ Nuevo cliente.</small>
      )}

      <label>
        Teléfono del cliente
        <input type="tel" value={datos.cliente_telefono} onChange={(e) => onCambiar({ cliente_telefono: e.target.value })} />
        <AvisoTelefono telefono={datos.cliente_telefono} />
      </label>
      {elegido?.cuenta && (
        <p className="nota-cliente">💳 Cuenta corriente: <strong>{elegido.cuenta.nombre}</strong> (el chofer la ve elegida al cobrar)</p>
      )}
      {deSiempre.length > 0 && (
        <div>
          <p className="etiqueta-campo">Sus viajes de siempre (tocá uno para llenar origen y destino)</p>
          <ul className="lista-elegir">
            {deSiempre.map((r) => (
              <li key={r.origen + '→' + r.destino}>
                <button type="button" className={'opcion-viaje' + (esEste(r) ? ' elegida' : '')}
                  onClick={() => onCambiar({ origen: r.origen, destino: r.destino })}>
                  <span>{r.origen}{r.destino && <> → {r.destino}</>}</span>
                  {r.veces > 1 && <small>{r.veces} veces</small>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
