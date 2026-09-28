import BotonSalir from './BotonSalir.jsx'

const NOMBRE_ROL = { admin: 'Administrador', operador: 'Operador' }

// Panel de gestión (admin y operadores). Por ahora solo muestra quién entró.
export default function Gestion({ perfil }) {
  return (
    <main className="pantalla">
      <h1>Panel de gestión</h1>
      <p className="aviso ok">
        Hola, {perfil.nombre} 👋<br />
        <small>Rol: {NOMBRE_ROL[perfil.rol]}</small>
      </p>
      {perfil.rol === 'admin' && (
        <p className="aviso">Como admin, acá vas a ver también la plata y la configuración.</p>
      )}
      <BotonSalir />
    </main>
  )
}
