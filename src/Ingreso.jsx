import { useState } from 'react'
import { supabase } from './supabase.js'
import { aEmail } from './usuarios.js'

export default function Ingreso() {
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function ingresar(e) {
    e.preventDefault()
    setError('')
    setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email: aEmail(usuario), password: clave })
    setEnviando(false)
    if (error) {
      setError(error.message === 'Invalid login credentials'
        ? 'Usuario o contraseña incorrectos.'
        : 'No se pudo ingresar: ' + error.message)
    }
  }

  return (
    <main className="pantalla">
      <h1>Remisería</h1>
      <form className="tarjeta" onSubmit={ingresar}>
        <label>
          Usuario o email
          <input type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off"
            value={usuario} onChange={(e) => setUsuario(e.target.value)} required />
        </label>
        <label>
          Contraseña
          <input type="password" autoComplete="current-password" value={clave}
            onChange={(e) => setClave(e.target.value)} required />
        </label>
        {error && <p className="aviso error">{error}</p>}
        <button className="boton" disabled={enviando}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </main>
  )
}
