import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { urlFotoAuto } from './fotos.js'
import BotonSalir from './BotonSalir.jsx'

// App del chofer. Por ahora muestra quién entró y su auto.
export default function Chofer({ perfil }) {
  const [auto, setAuto] = useState(null)

  useEffect(() => {
    supabase.from('choferes').select('*').eq('id', perfil.id).maybeSingle()
      .then(({ data }) => setAuto(data))
  }, [perfil.id])

  return (
    <main className="pantalla">
      <h1>App del chofer</h1>
      <p className="aviso ok">Hola, {perfil.nombre} 👋</p>
      {auto && (
        <div className="tarjeta separada">
          {auto.foto_auto && (
            <div className="foto-auto"><img src={urlFotoAuto(auto.foto_auto)} alt="Tu auto" /></div>
          )}
          <p className="sin-margen">
            <strong>{[auto.auto_modelo, auto.auto_color].filter(Boolean).join(' · ') || 'Auto sin cargar'}</strong>
            {auto.patente && <><br />Patente: {auto.patente}</>}
          </p>
        </div>
      )}
      <BotonSalir />
    </main>
  )
}
