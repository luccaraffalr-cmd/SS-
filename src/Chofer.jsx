import BotonSalir from './BotonSalir.jsx'

// App del chofer. Por ahora solo muestra quién entró.
export default function Chofer({ perfil }) {
  return (
    <main className="pantalla">
      <h1>App del chofer</h1>
      <p className="aviso ok">Hola, {perfil.nombre} 👋</p>
      <BotonSalir />
    </main>
  )
}
