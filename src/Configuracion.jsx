import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { useConfiguracion } from './configuracion.js'

// Ajustes generales (solo admin).
export default function Configuracion() {
  const config = useConfiguracion()
  const [minutos, setMinutos] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { setMinutos(String(config.minutos_sin_senal)) }, [config.minutos_sin_senal])

  async function guardar(e) {
    e.preventDefault()
    setMensaje('')
    setError('')
    const n = Number(minutos)
    if (!Number.isInteger(n) || n < 1 || n > 120) {
      setError('Tiene que ser un número entero entre 1 y 120.')
      return
    }
    const { error } = await supabase.from('configuracion').update({ minutos_sin_senal: n }).eq('id', 1)
    if (error) setError('No se pudo guardar: ' + error.message)
    else setMensaje('Guardado ✅')
  }

  return (
    <form className="tarjeta separada" onSubmit={guardar}>
      <h2>Configuración</h2>
      <label>
        Minutos sin reportar para la alerta "sin señal"
        <input inputMode="numeric" value={minutos} onChange={(e) => setMinutos(e.target.value)} />
        <small className="ayuda">
          Si un chofer que está Yendo o En viaje pasa este tiempo sin reportar, aparece la alerta
          (los que están en la cola no tienen alerta).
          Un chofer que solo estaba conectado pasa a desconectado.
        </small>
      </label>
      {error && <p className="aviso error">{error}</p>}
      {mensaje && <p className="aviso ok">{mensaje}</p>}
      <button className="boton">Guardar</button>
    </form>
  )
}
