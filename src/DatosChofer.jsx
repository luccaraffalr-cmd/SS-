import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { achicarFoto, urlFotoAuto } from './fotos.js'

// Ficha del chofer dentro de la edición de usuario (solo admin): auto, foto, oculto y comisión.
export default function DatosChofer({ choferId }) {
  const [datos, setDatos] = useState(null)
  const [comision, setComision] = useState('')
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('choferes').select('*').eq('id', choferId).maybeSingle(),
      supabase.from('comisiones').select('porcentaje').eq('chofer_id', choferId).maybeSingle(),
    ]).then(([ch, co]) => {
      const c = ch.data ?? {}
      setDatos({
        auto_modelo: c.auto_modelo ?? '', auto_color: c.auto_color ?? '', patente: c.patente ?? '',
        foto_auto: c.foto_auto ?? null, oculto: c.oculto ?? false, equipo_traccar: c.equipo_traccar ?? '',
      })
      setComision(String(co.data?.porcentaje ?? 20))
    })
  }, [choferId])

  if (!datos) return <div className="tarjeta separada"><p>Cargando datos del chofer…</p></div>

  const cambiar = (campo) => (e) => setDatos({ ...datos, [campo]: e.target.value })

  async function guardar() {
    setError('')
    setMensaje('')
    const porcentaje = Number(comision.replace(',', '.'))
    if (Number.isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100) {
      setError('La comisión tiene que ser un número entre 0 y 100.')
      return
    }
    setGuardando(true)
    const [r1, r2] = await Promise.all([
      supabase.from('choferes').upsert({
        id: choferId,
        auto_modelo: datos.auto_modelo.trim() || null,
        auto_color: datos.auto_color.trim() || null,
        patente: datos.patente.trim().toUpperCase() || null,
        oculto: datos.oculto,
        equipo_traccar: datos.equipo_traccar.trim() || null,
      }),
      supabase.from('comisiones').upsert({ chofer_id: choferId, porcentaje }),
    ])
    setGuardando(false)
    const err = r1.error || r2.error
    if (err?.code === '23505') setError('Ese número de Traccar ya lo tiene otro chofer.')
    else if (err) setError('No se pudo guardar: ' + err.message)
    else {
      setDatos({ ...datos, patente: datos.patente.trim().toUpperCase() })
      setMensaje('Datos del chofer guardados ✅')
    }
  }

  async function subirFoto(e) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    setError('')
    setMensaje('')
    setSubiendo(true)
    try {
      const foto = await achicarFoto(archivo)
      const ruta = `${choferId}/${Date.now()}.jpg`
      const { error: errSubida } = await supabase.storage.from('autos')
        .upload(ruta, foto, { contentType: 'image/jpeg' })
      if (errSubida) throw errSubida
      const { error: errGuardar } = await supabase.from('choferes').upsert({ id: choferId, foto_auto: ruta })
      if (errGuardar) throw errGuardar
      if (datos.foto_auto) await supabase.storage.from('autos').remove([datos.foto_auto])
      setDatos({ ...datos, foto_auto: ruta })
      setMensaje('Foto guardada ✅')
    } catch (err) {
      setError('No se pudo subir la foto: ' + err.message)
    }
    setSubiendo(false)
  }

  return (
    <div className="tarjeta separada">
      <h2>Datos del chofer</h2>

      <div className="foto-auto">
        {datos.foto_auto
          ? <img src={urlFotoAuto(datos.foto_auto)} alt="Foto del auto" />
          : <span>Sin foto del auto</span>}
      </div>
      <label className="boton secundario boton-archivo">
        {subiendo ? 'Subiendo…' : datos.foto_auto ? 'Cambiar foto del auto' : 'Subir foto del auto'}
        <input type="file" accept="image/*" onChange={subirFoto} disabled={subiendo} hidden />
      </label>

      <label>Modelo del auto<input value={datos.auto_modelo} onChange={cambiar('auto_modelo')} placeholder="ej: Chevrolet Spin" /></label>
      <label>Color<input value={datos.auto_color} onChange={cambiar('auto_color')} placeholder="ej: Gris" /></label>
      <label>Patente<input value={datos.patente} onChange={cambiar('patente')} autoCapitalize="characters" placeholder="ej: AB123CD" /></label>
      <label>
        N.º en Traccar Client
        <input inputMode="numeric" value={datos.equipo_traccar} onChange={cambiar('equipo_traccar')} placeholder="ej: 3" />
        <small className="ayuda">El "identificador del dispositivo" que tiene configurado en su celular (el número de "Auto 3"). Sin esto no aparece en el mapa.</small>
      </label>
      <label>
        Comisión (%)
        <input inputMode="decimal" value={comision} onChange={(e) => setComision(e.target.value)} />
        <small className="ayuda">Lo que se queda la remisería de cada viaje. Solo lo ve el admin (y el propio chofer).</small>
      </label>
      <label className="casilla">
        <input type="checkbox" checked={datos.oculto}
          onChange={(e) => setDatos({ ...datos, oculto: e.target.checked })} />
        Oculto (los demás choferes no lo ven y no entra en la cola; solo recibe viajes asignados a mano)
      </label>

      {error && <p className="aviso error">{error}</p>}
      {mensaje && <p className="aviso ok">{mensaje}</p>}
      <button type="button" className="boton" disabled={guardando} onClick={guardar}>
        {guardando ? 'Guardando…' : 'Guardar datos del chofer'}
      </button>
    </div>
  )
}
