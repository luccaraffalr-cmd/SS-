import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import Ingreso from './Ingreso.jsx'

export default function App() {
  // undefined = todavía cargando; null = sin sesión
  const [sesion, setSesion] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session))
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSesion(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (sesion === undefined) return <main className="pantalla"><p>Cargando…</p></main>
  if (!sesion) return <Ingreso />

  return (
    <main className="pantalla">
      <h1>Remisería</h1>
      <p className="aviso ok">Hola, {sesion.user.email} 👋</p>
      <button className="boton secundario" onClick={() => supabase.auth.signOut()}>
        Cerrar sesión
      </button>
    </main>
  )
}
