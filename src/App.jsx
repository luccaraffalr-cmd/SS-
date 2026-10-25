import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import Ingreso from './Ingreso.jsx'
import Gestion from './Gestion.jsx'
import Chofer from './Chofer.jsx'
import BotonSalir from './BotonSalir.jsx'
import ElegirClave from './ElegirClave.jsx'
import AgregarCompartido from './AgregarCompartido.jsx'
import { alCompartir, leerCompartido } from './compartidoApp.js'

export default function App() {
  // undefined = todavía cargando; null = sin sesión / sin perfil
  const [sesion, setSesion] = useState(undefined)
  const [perfil, setPerfil] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session))
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSesion(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const usuarioId = sesion?.user.id
  useEffect(() => {
    if (!usuarioId) { setPerfil(null); return }
    setPerfil(undefined)
    supabase.from('perfiles').select('*').eq('id', usuarioId).maybeSingle()
      .then(({ data }) => setPerfil(data && data.activo ? data : null))
  }, [usuarioId])

  // Lo que compartieron desde WhatsApp hacia la app (versión 3): se lee recién con la sesión abierta.
  const [compartido, setCompartido] = useState(null)
  const conPerfil = !!perfil && !perfil.debe_cambiar_clave
  useEffect(() => {
    if (!conPerfil) return
    const revisar = () => leerCompartido().then((c) => { if (c) setCompartido(c) })
    const dejarDeEscuchar = alCompartir(revisar)
    revisar()
    return dejarDeEscuchar
  }, [conPerfil])

  if (sesion === undefined) return <main className="pantalla"><p>Cargando…</p></main>
  if (!sesion) return <Ingreso />
  if (perfil === undefined) return <main className="pantalla"><p>Cargando…</p></main>

  if (!perfil) {
    return (
      <main className="pantalla">
        <h1>Remisería</h1>
        <p className="aviso error">Tu usuario no tiene permiso para usar la app. Hablá con el administrador.</p>
        <BotonSalir />
      </main>
    )
  }

  if (perfil.debe_cambiar_clave) {
    return <ElegirClave perfil={perfil} onListo={() => setPerfil({ ...perfil, debe_cambiar_clave: false })} />
  }
  if (compartido) return <AgregarCompartido compartido={compartido} perfil={perfil} onListo={() => setCompartido(null)} />
  if (perfil.rol === 'chofer') return <Chofer perfil={perfil} />
  return <Gestion perfil={perfil} />
}
