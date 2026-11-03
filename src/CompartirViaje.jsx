import { useState } from 'react'
import { supabase } from './supabase.js'
import { fechaCorta, hora } from './viajes.js'
import { telefonoParaWhatsApp } from './clientes.js'

const linkDe = (codigo) => `${window.location.origin}/seguir/${codigo}`

// El mensaje para el pasajero: si es un programado que todavía no salió (link mandado antes, 26/10/2026), con la fecha.
function mensajeDe(link, viaje) {
  if (viaje.tipo === 'programado' && !viaje.iniciado_en && viaje.hora_presentacion) {
    return `Tu remis del ${fechaCorta(viaje.hora_presentacion)} a las ${hora(viaje.hora_presentacion)}: `
      + `con este link vas a poder seguirlo cuando salga a buscarte: ${link}`
  }
  return `Tu remis está en camino. Seguilo acá: ${link}`
}
// Con un teléfono que sirve, abre directo el chat del cliente (2/11/2026); si no, WhatsApp pregunta a quién mandarlo.
const urlWhatsApp = (link, viaje) => 'https://wa.me/' + (telefonoParaWhatsApp(viaje.cliente_telefono) ?? '')
  + '?text=' + encodeURIComponent(mensajeDe(link, viaje))

// Abre un link afuera de la app (como tocar un link): en la app Android, WhatsApp se abre solo.
function abrirAfuera(url) {
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noreferrer'
  a.click()
}

// Gestión: link de seguimiento de un viaje para mandárselo al pasajero. Directamente "WhatsApp" o "Copiar link"
// (pedido del 22/10/2026): el link se genera solo la primera vez que se toca uno de los dos.
export default function CompartirViaje({ viaje }) {
  const [codigo, setCodigo] = useState(viaje.codigo_seguimiento)
  const [error, setError] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [generando, setGenerando] = useState(false)
  const link = codigo ? linkDe(codigo) : ''

  // Devuelve el link (generándolo si todavía no existe) o null si no se pudo.
  async function obtenerLink() {
    if (codigo) return link
    setError('')
    setGenerando(true)
    const { data, error } = await supabase.rpc('compartir_viaje', { viaje: viaje.id })
    setGenerando(false)
    if (error) { setError('No se pudo generar el link: ' + error.message); return null }
    setCodigo(data)
    return linkDe(data)
  }

  async function mandarPorWhatsApp() {
    const nuevo = await obtenerLink()
    if (nuevo) abrirAfuera(urlWhatsApp(nuevo, viaje))
  }

  async function copiar() {
    const nuevo = await obtenerLink()
    if (!nuevo) return
    try {
      await navigator.clipboard.writeText(nuevo)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      setError('No se pudo copiar. Mantené apretado el link de abajo para copiarlo a mano.')
    }
  }

  return (
    <div className="tarjeta separada">
      <h2>📍 Seguimiento para el pasajero</h2>
      <p className="ayuda sin-margen">
        Un link con el mapa del auto en vivo, la foto, el modelo y la patente. Se apaga solo cuando el viaje se finaliza o se anula.
        {viaje.tipo === 'programado' && !viaje.iniciado_en
          && ' Lo podés mandar desde ya: hasta que el chofer salga a buscarlo, muestra la fecha y la hora (sin el mapa).'}
        {telefonoParaWhatsApp(viaje.cliente_telefono) && ` "WhatsApp" abre directo el chat con ${viaje.cliente_telefono}.`}
      </p>
      <div className="dos-columnas">
        {codigo ? (
          <a className="boton verde" href={urlWhatsApp(link, viaje)} target="_blank" rel="noreferrer">WhatsApp</a>
        ) : (
          <button type="button" className="boton verde" disabled={generando} onClick={mandarPorWhatsApp}>
            {generando ? 'Generando…' : 'WhatsApp'}
          </button>
        )}
        <button type="button" className="boton secundario" disabled={generando} onClick={copiar}>
          {copiado ? 'Copiado ✅' : 'Copiar link'}
        </button>
      </div>
      {link && <a className="link-seguimiento" href={link} target="_blank" rel="noreferrer">{link}</a>}
      {error && <p className="aviso error">{error}</p>}
    </div>
  )
}
