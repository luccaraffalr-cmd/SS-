import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { Actualizacion, versionDeLaApp } from './actualizacionApp.js'

// App Android (versión 2 o más): si hay una versión nueva de la app (tabla config_app), un cartel con "Actualizar"
// que la baja y abre el instalador de Android. La primera vez, Android pide permiso para que la app se actualice sola.
export default function ActualizarApp() {
  const [nueva, setNueva] = useState(null) // { version_nombre, apk_url, novedades }
  const [estado, setEstado] = useState('') // '' | 'bajando' | 'permiso' | 'instalar' | 'error'
  const [porcentaje, setPorcentaje] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function revisar() {
      const mia = await versionDeLaApp()
      if (!mia || mia.codigo < 2) return // en el navegador, o la app vieja (que no se puede actualizar sola)
      const { data } = await supabase.from('config_app')
        .select('version_codigo, version_nombre, apk_url, novedades').eq('id', 1).maybeSingle()
      setNueva(data?.apk_url && data.version_codigo > mia.codigo ? data : null)
    }
    revisar()
    const alVolver = () => { if (document.visibilityState === 'visible') revisar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [])

  async function actualizar() {
    setError('')
    setEstado('bajando')
    setPorcentaje(null)
    const escucha = await Actualizacion.addListener('progreso', ({ porcentaje }) => setPorcentaje(porcentaje))
    try {
      const r = await Actualizacion.instalar({ url: nueva.apk_url })
      setEstado(r.permiso === false ? 'permiso' : 'instalar')
    } catch (e) {
      setEstado('error')
      setError(e.message)
    }
    escucha.remove()
  }

  if (!nueva) return null
  return (
    <div className="aviso-version aviso-app">
      <strong>📲 Hay una versión nueva de la app ({nueva.version_nombre})</strong>
      {nueva.novedades && <span>{nueva.novedades}</span>}
      {estado === 'bajando' && <span>Bajando la actualización…{porcentaje > 0 && ` ${porcentaje}%`}</span>}
      {estado === 'permiso' && (
        <span>
          Android te abrió un permiso: activá <b>"Permitir de esta fuente"</b>, volvé a la app y tocá <b>Actualizar</b> otra vez.
          Es una sola vez.
        </span>
      )}
      {estado === 'instalar' && <span>Ahora tocá <b>"Actualizar"</b> (o "Instalar") en la ventana de Android.</span>}
      {estado === 'error' && <span>{error}</span>}
      {estado !== 'bajando' && (
        <button className="boton verde" onClick={actualizar}>
          {estado === 'instalar' ? 'Abrir el instalador de nuevo' : 'Actualizar'}
        </button>
      )}
    </div>
  )
}
