import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const CENTRO_INICIAL = [-34.65, -58.79]

// Si la última ubicación es más vieja que esto, el auto se muestra apagado ("sin señal").
export const MINUTOS_SIN_SENAL = 3

// Crea un mapa de OpenStreetMap dentro de un elemento de la página.
export function crearMapa(elemento) {
  const mapa = L.map(elemento).setView(CENTRO_INICIAL, 13)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap',
  }).addTo(mapa)
  return mapa
}

const escapar = (texto) => String(texto).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// Marcador del auto: 🚕 con el nombre abajo (opcional). `clase` le da el color (estado del chofer).
export function iconoAuto(nombre, clase = '') {
  return L.divIcon({
    className: 'marcador-auto ' + clase,
    html: '🚕' + (nombre ? `<b>${escapar(nombre)}</b>` : ''),
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

export function crearMarcador(lat, lon, icono) {
  return L.marker([lat, lon], { icon: icono })
}

export function sinSenal(reportadoEn, ahora = Date.now()) {
  return ahora - new Date(reportadoEn).getTime() > MINUTOS_SIN_SENAL * 60 * 1000
}
