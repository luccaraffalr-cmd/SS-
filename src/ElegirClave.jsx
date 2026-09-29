import { useState } from 'react'
import { supabase } from './supabase.js'
import BotonSalir from './BotonSalir.jsx'

// Primera vez que entra (o después de que el admin le puso una contraseña nueva):
// tiene que elegir su propia contraseña, que el admin no sabe.
export default function ElegirClave({ perfil, onListo }) {
  const [clave, setClave] = useState('')
  const [repetida, setRepetida] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function guardar(e) {
    e.preventDefault()
    setError('')
    if (clave.length < 6) return setError('La contraseña tiene que tener al menos 6 caracteres.')
    if (clave !== repetida) return setError('Las dos contraseñas no son iguales. Escribilas de nuevo.')
    setEnviando(true)
    const { error } = await supabase.auth.updateUser({ password: clave })
    if (error) {
      setEnviando(false)
      return setError(/different|same/i.test(error.message)
        ? 'Tiene que ser distinta de la contraseña que te pasaron.'
        : 'No se pudo cambiar: ' + error.message)
    }
    const { error: errorMarca } = await supabase.rpc('clave_cambiada')
    setEnviando(false)
    if (errorMarca) return setError('No se pudo guardar: ' + errorMarca.message)
    onListo()
  }

  return (
    <main className="pantalla">
      <h1>Hola, {perfil.nombre}</h1>
      <p className="aviso">
        🔑 Elegí tu contraseña. Es solo tuya: nadie más la va a saber, ni la remisería.
        La vas a usar para entrar a la app de ahora en adelante.
      </p>
      <form className="tarjeta separada" onSubmit={guardar}>
        <p className="ayuda sin-margen">Tu usuario para entrar: <strong>{perfil.usuario}</strong></p>
        <label>
          Contraseña nueva
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required minLength={6}
            autoComplete="new-password" />
          <small className="ayuda">Mínimo 6 caracteres. Anotala en un lugar seguro.</small>
        </label>
        <label>
          Repetila
          <input type="password" value={repetida} onChange={(e) => setRepetida(e.target.value)} required
            autoComplete="new-password" />
        </label>
        {error && <p className="aviso error">{error}</p>}
        <button className="boton" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar mi contraseña'}</button>
      </form>
      <BotonSalir />
    </main>
  )
}
