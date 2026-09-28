import { useEffect, useState } from 'react'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js'

// Tarea 1: solo comprueba que la app llega a Supabase.
export default function App() {
  const [estado, setEstado] = useState('probando')

  useEffect(() => {
    fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } })
      .then((r) => setEstado(r.ok ? 'ok' : 'error'))
      .catch(() => setEstado('error'))
  }, [])

  return (
    <main className="pantalla">
      <h1>Remisería</h1>
      {estado === 'probando' && <p className="aviso">Probando conexión…</p>}
      {estado === 'ok' && <p className="aviso ok">Conectado a Supabase ✅</p>}
      {estado === 'error' && <p className="aviso error">No se pudo conectar a Supabase ❌</p>}
    </main>
  )
}
