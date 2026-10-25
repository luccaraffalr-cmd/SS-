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

// De celeste (principio del viaje) a azul oscuro (final): así se distingue la ida de la vuelta por la misma calle.
function colorDelTramo(fraccion) {
  const desde = [56, 189, 248], hasta = [30, 41, 120]
  return `rgb(${desde.map((x, i) => Math.round(x + (hasta[i] - x) * fraccion)).join(',')})`
}

// Recorrido de un viaje en una capa del mapa (se puede borrar y volver a dibujar). puntos: [[lat, lon]…];
// paradas: [{ lat, lon, minutos, texto }] (detenido 3 minutos o más, en rojo). Devuelve el área para encuadrarlo.
export function dibujarRecorrido(capa, puntos, paradas, enCurso) {
  const tramos = Math.min(40, puntos.length - 1)
  for (let t = 0; t < tramos; t++) {
    const desde = Math.floor((t * (puntos.length - 1)) / tramos)
    const hasta = Math.floor(((t + 1) * (puntos.length - 1)) / tramos)
    L.polyline(puntos.slice(desde, hasta + 1), {
      color: colorDelTramo(tramos === 1 ? 0 : t / (tramos - 1)), weight: 5, opacity: 0.9,
    }).addTo(capa)
  }
  for (const p of paradas) {
    L.circleMarker([p.lat, p.lon], {
      radius: Math.min(14, 7 + p.minutos / 3), color: '#991b1b', weight: 2, fillColor: '#ef4444', fillOpacity: 0.85,
    }).bindPopup(escapar(p.texto)).addTo(capa)
  }
  const marca = (texto) => L.divIcon({ className: 'marca-recorrido', html: texto, iconSize: [26, 26], iconAnchor: [13, 13] })
  L.marker(puntos[0], { icon: marca('🟢') }).addTo(capa)
  L.marker(puntos[puntos.length - 1], { icon: enCurso ? iconoAuto('') : marca('🏁') }).addTo(capa)
  return L.latLngBounds(puntos)
}

export const crearCapa = (mapa) => L.layerGroup().addTo(mapa)

export function crearMarcador(lat, lon, icono) {
  return L.marker([lat, lon], { icon: icono })
}

export function sinSenal(reportadoEn, ahora = Date.now()) {
  return ahora - new Date(reportadoEn).getTime() > MINUTOS_SIN_SENAL * 60 * 1000
}
