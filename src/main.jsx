import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AvisoVersion from './AvisoVersion.jsx'
import Seguimiento from './Seguimiento.jsx'
import './estilos.css'
import { registrarServiceWorker } from './notificaciones.js'

// Link de seguimiento del pasajero (/seguir/<código>): página pública, sin usuario ni notificaciones.
const codigoSeguimiento = window.location.pathname.match(/^\/seguir\/([^/]+)/)?.[1]

if (!codigoSeguimiento) registrarServiceWorker()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {codigoSeguimiento ? <Seguimiento codigo={codigoSeguimiento} /> : (
      <>
        <AvisoVersion />
        <App />
      </>
    )}
  </React.StrictMode>,
)
