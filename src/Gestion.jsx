import { useState } from 'react'
import BotonSalir from './BotonSalir.jsx'
import Usuarios from './Usuarios.jsx'
import Choferes from './Choferes.jsx'
import Viajes from './Viajes.jsx'
import CuentasCorrientes from './CuentasCorrientes.jsx'
import { NOMBRE_ROL } from './usuarios.js'

// Panel de gestión (admin y operadores).
export default function Gestion({ perfil }) {
  const esAdmin = perfil.rol === 'admin'
  const [seccion, setSeccion] = useState('viajes')

  const pestanas = [
    ['viajes', 'Viajes'],
    ['choferes', 'Choferes'],
    ...(esAdmin ? [['cuentas', 'Cuentas'], ['usuarios', 'Usuarios']] : []),
    ['cuenta', 'Mi cuenta'],
  ]

  return (
    <>
      <nav className="pestanas">
        {pestanas.map(([id, texto]) => (
          <button key={id} className={seccion === id ? 'activa' : ''} onClick={() => setSeccion(id)}>{texto}</button>
        ))}
      </nav>

      {seccion === 'viajes' && <Viajes />}
      {seccion === 'choferes' && <Choferes />}
      {seccion === 'cuentas' && esAdmin && <CuentasCorrientes />}
      {seccion === 'usuarios' && esAdmin && <Usuarios yo={perfil} />}
      {seccion === 'cuenta' && (
        <main className="pantalla">
          <h1>Mi cuenta</h1>
          <p className="aviso ok">
            {perfil.nombre}<br />
            <small>Rol: {NOMBRE_ROL[perfil.rol]}</small>
          </p>
          <BotonSalir />
        </main>
      )}
    </>
  )
}
