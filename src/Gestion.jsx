import { useEffect, useState } from 'react'
import BotonSalir from './BotonSalir.jsx'
import ActivarNotificaciones from './ActivarNotificaciones.jsx'
import { esAppAndroid } from './ubicacionApp.js'
import { sonarConLaAppAbierta } from './notificacionesApp.js'
import Usuarios from './Usuarios.jsx'
import Choferes from './Choferes.jsx'
import Viajes from './Viajes.jsx'
import CuentasCorrientes from './CuentasCorrientes.jsx'
import Mapa from './Mapa.jsx'
import AlertaSinChofer from './AlertaSinChofer.jsx'
import { NOMBRE_ROL } from './usuarios.js'

// Panel de gestión (admin y operadores).
export default function Gestion({ perfil }) {
  const esAdmin = perfil.rol === 'admin'
  const [seccion, setSeccion] = useState('viajes')

  // Para el admin, Mapa va al final de todo (pedido del 21/10/2026).
  const pestanas = esAdmin
    ? [['viajes', 'Viajes'], ['choferes', 'Choferes'], ['cuentas', 'Cuentas'], ['usuarios', 'Usuarios'],
        ['cuenta', 'Mi cuenta'], ['mapa', 'Mapa']]
    : [['viajes', 'Viajes'], ['choferes', 'Choferes'], ['mapa', 'Mapa'], ['cuenta', 'Mi cuenta']]

  // Los admins reciben avisos (decidido el 21/10/2026): "Salió un viaje para Juan" y las alertas del cartel rojo.
  useEffect(() => {
    if (!esAdmin || !esAppAndroid) return
    const escucha = sonarConLaAppAbierta()
    return () => { escucha.then((e) => e.remove()) }
  }, [esAdmin])

  return (
    <>
      <nav className="pestanas">
        {pestanas.map(([id, texto]) => (
          <button key={id} className={seccion === id ? 'activa' : ''} onClick={() => setSeccion(id)}>{texto}</button>
        ))}
      </nav>
      <AlertaSinChofer onVer={() => setSeccion('viajes')} />
      {esAdmin && (
        <div className="avisos-gestion">
          <ActivarNotificaciones discreto explicacion={'Así te suena el celular cuando sale un viaje de la cola y cuando un'
            + ' viaje se queda sin chofer, el chofer no lo acepta o no sale, aunque tengas la app cerrada.'} />
        </div>
      )}

      {seccion === 'viajes' && <Viajes />}
      {seccion === 'choferes' && <Choferes />}
      {seccion === 'mapa' && <Mapa />}
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
