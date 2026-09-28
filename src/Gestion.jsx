import { useState } from 'react'
import BotonSalir from './BotonSalir.jsx'
import Usuarios from './Usuarios.jsx'
import { NOMBRE_ROL } from './usuarios.js'

// Panel de gestión (admin y operadores).
export default function Gestion({ perfil }) {
  const esAdmin = perfil.rol === 'admin'
  const [seccion, setSeccion] = useState('inicio')

  return (
    <>
      <nav className="pestanas">
        <button className={seccion === 'inicio' ? 'activa' : ''} onClick={() => setSeccion('inicio')}>Inicio</button>
        {esAdmin && (
          <button className={seccion === 'usuarios' ? 'activa' : ''} onClick={() => setSeccion('usuarios')}>Usuarios</button>
        )}
      </nav>

      {seccion === 'usuarios' && esAdmin ? (
        <Usuarios yo={perfil} />
      ) : (
        <main className="pantalla">
          <h1>Panel de gestión</h1>
          <p className="aviso ok">
            Hola, {perfil.nombre} 👋<br />
            <small>Rol: {NOMBRE_ROL[perfil.rol]}</small>
          </p>
          <BotonSalir />
        </main>
      )}
    </>
  )
}
