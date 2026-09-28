import { supabase } from './supabase.js'

export default function BotonSalir() {
  return (
    <button className="boton secundario" onClick={() => supabase.auth.signOut()}>
      Cerrar sesión
    </button>
  )
}
