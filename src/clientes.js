// Clientes guardados (2/11/2026, SQL 050): teléfono para WhatsApp, búsqueda y viajes de siempre.

// Sin tildes, en minúsculas y con un solo espacio entre palabras (para buscar "jose" y encontrar "José").
export function normalizar(texto) {
  return (texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// El teléfono como lo pide WhatsApp ("5491155551234"), o null si así no sirve (por ejemplo, sin código de área).
// Acepta "11 5555-1234", "011 15 5555-1234", "+54 9 11 5555-1234" y parecidos. Un número de otro país, con "+".
export function telefonoParaWhatsApp(texto) {
  const crudo = (texto ?? '').trim()
  let n = crudo.replace(/\D/g, '')
  if (!n) return null
  if (crudo.startsWith('+') && !n.startsWith('54')) return n.length >= 8 && n.length <= 15 ? n : null
  if (n.startsWith('54') && n.length >= 12) n = n.slice(2)
  if (n.startsWith('9') && n.length === 11) n = n.slice(1) // el 9 de los celulares, después del 54
  if (n.startsWith('0')) n = n.slice(1)
  // El 15 va después del código de área (de 2, 3 o 4 números): se saca.
  if (n.length === 12) {
    const area = [2, 3, 4].find((a) => n.slice(a, a + 2) === '15')
    if (area) n = n.slice(0, area) + n.slice(area + 2)
  }
  // 10 números = código de área + número. Ningún código de área empieza con 15 ni con 0.
  if (n.length !== 10 || n.startsWith('15')) return null
  return '549' + n
}

// Los clientes que coinciden con lo escrito (cada palabra, en cualquier parte del nombre, o números del teléfono):
// primero los que empiezan así y después los que más viajan.
export function buscarClientes(clientes, texto, cuantos = 5) {
  const q = normalizar(texto)
  if (q.length < 2) return []
  const palabras = q.split(' ')
  const numeros = texto.replace(/\D/g, '')
  return clientes
    .filter((c) => {
      const nombre = normalizar(c.nombre)
      return palabras.every((p) => nombre.includes(p))
        || (numeros.length >= 3 && (c.telefono ?? '').replace(/\D/g, '').includes(numeros))
    })
    .sort((a, b) => (normalizar(b.nombre).startsWith(q) - normalizar(a.nombre).startsWith(q))
      || (cantidadDeViajes(b) - cantidadDeViajes(a))
      || a.nombre.localeCompare(b.nombre))
    .slice(0, cuantos)
}

// Con la consulta "viajes(count)".
export const cantidadDeViajes = (c) => c.viajes?.[0]?.count ?? 0

// Lo que se pide de cada cliente para elegirlo en un viaje o mostrarlo en la lista.
export const CONSULTA_CLIENTES = 'id, nombre, telefono, nota, cuenta_id, cuenta:cuentas_corrientes(nombre), viajes(count)'

// Los recorridos que más se repiten en sus viajes (origen → destino), del más usado al menos usado. viajes: los más
// nuevos primero (queda escrito como la última vez).
export function viajesDeSiempre(viajes, cuantos = 4) {
  const recorridos = new Map()
  for (const v of viajes) {
    const origen = v.origen?.trim()
    if (!origen) continue
    const destino = v.destino?.trim() || ''
    const clave = normalizar(origen) + '→' + normalizar(destino)
    const r = recorridos.get(clave)
    if (r) r.veces++
    else recorridos.set(clave, { origen, destino, veces: 1 })
  }
  return [...recorridos.values()].sort((a, b) => b.veces - a.veces).slice(0, cuantos)
}
