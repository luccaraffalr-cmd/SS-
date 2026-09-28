import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AvisoVersion from './AvisoVersion.jsx'
import './estilos.css'
import { registrarServiceWorker } from './notificaciones.js'

registrarServiceWorker()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AvisoVersion />
    <App />
  </React.StrictMode>,
)
