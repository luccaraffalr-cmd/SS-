import { supabase } from './supabase.js'

// Adjuntos de un viaje (decidido el 22/10/2026): links (ej. la autorización del country), ubicaciones, fotos, audios y
// archivos, pegados a una parte del viaje: 'origen', 'destino' u 'observaciones'.
// Cada uno: { id, campo, tipo: 'ubicacion'|'link'|'foto'|'audio'|'archivo', url (link o ubicación), ruta (archivo), nombre }.
// Las fotos, audios y archivos van a la carpeta privada "adjuntos" de Supabase (los ve gestión y el chofer del viaje).

const nuevoId = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2)

const ES_MAPA = /(google\.[a-z.]+\/maps|maps\.google\.|maps\.app\.goo\.gl|goo\.gl\/maps|waze\.com)/i

// Del texto pegado (puede ser un mensaje entero de WhatsApp) saca el link. Unas coordenadas sueltas
// ("-34.6037, -58.3816") se convierten en un link de Google Maps. null si no hay nada.
export function leerLink(texto) {
  const t = String(texto ?? '').trim()
  const link = t.match(/https?:\/\/\S+/i)?.[0] ?? t.match(/\bwww\.\S+/i)?.[0]
  if (link) return (link.startsWith('www.') ? 'https://' + link : link).replace(/[).,;!?]+$/, '')
  const c = t.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/)
  return c ? `https://www.google.com/maps/search/?api=1&query=${c[1]},${c[2]}` : null
}

export const esUbicacion = (url) => ES_MAPA.test(url ?? '')

// Link o ubicación pegados por gestión (null si no hay un link).
export function adjuntoDeLink(campo, texto, nombre = '') {
  const url = leerLink(texto)
  if (!url) return null
  return { id: nuevoId(), campo, tipo: esUbicacion(url) ? 'ubicacion' : 'link', url, nombre: nombre.trim() || null }
}

const AUDIOS = ['opus', 'ogg', 'oga', 'mp3', 'm4a', 'aac', 'wav', 'amr', '3gp', 'webm']

function extension(nombre) {
  const ext = nombre.includes('.') ? nombre.split('.').pop().toLowerCase() : ''
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'bin'
}

function tipoDeArchivo(archivo) {
  if (archivo.type.startsWith('image/')) return 'foto'
  if (archivo.type.startsWith('audio/') || AUDIOS.includes(extension(archivo.name))) return 'audio'
  return 'archivo'
}

// Las fotos del celular pesan mucho: se achican (1600 px como mucho) para que suban rápido y ocupen poco.
async function achicarFoto(archivo) {
  try {
    const imagen = await createImageBitmap(archivo, { imageOrientation: 'from-image' })
    const escala = Math.min(1, 1600 / Math.max(imagen.width, imagen.height))
    if (escala === 1 && archivo.size < 500 * 1024) return archivo
    const lienzo = document.createElement('canvas')
    lienzo.width = Math.round(imagen.width * escala)
    lienzo.height = Math.round(imagen.height * escala)
    lienzo.getContext('2d').drawImage(imagen, 0, 0, lienzo.width, lienzo.height)
    return (await new Promise((listo) => lienzo.toBlob(listo, 'image/jpeg', 0.8))) ?? archivo
  } catch {
    return archivo // si no se puede achicar, se sube como está
  }
}

// Sube una foto, audio o archivo y devuelve el adjunto (tira un error si no pudo).
export async function subirArchivo(campo, archivo) {
  const tipo = tipoDeArchivo(archivo)
  const datos = tipo === 'foto' ? await achicarFoto(archivo) : archivo
  const ext = datos !== archivo ? 'jpg' : extension(archivo.name)
  // Los audios de WhatsApp (.opus) a veces llegan sin tipo: si no, el celular no los reproduce.
  const contentType = datos.type || (['opus', 'ogg', 'oga'].includes(ext) ? 'audio/ogg' : undefined)
  const ruta = `${nuevoId()}.${ext}`
  const { error } = await supabase.storage.from('adjuntos').upload(ruta, datos, { contentType })
  if (error) throw new Error(error.message)
  return { id: nuevoId(), campo, tipo, ruta, nombre: tipo === 'archivo' ? archivo.name : null }
}

// Link para ver un archivo de la carpeta privada (dura un día; se guarda para no pedirlo cada vez).
const urlsGuardadas = new Map()
export function urlDeArchivo(ruta) {
  const guardada = urlsGuardadas.get(ruta)
  if (guardada && guardada.vence > Date.now()) return guardada.url
  const url = supabase.storage.from('adjuntos').createSignedUrl(ruta, 24 * 60 * 60).then(({ data, error }) => {
    if (error) { urlsGuardadas.delete(ruta); throw new Error(error.message) }
    return data.signedUrl
  })
  urlsGuardadas.set(ruta, { url, vence: Date.now() + 23 * 60 * 60 * 1000 })
  return url
}

// Lo que dice el botoncito de cada adjunto.
export function textoAdjunto(a) {
  if (a.tipo === 'ubicacion') return `📍 ${a.nombre || 'Ver en el mapa'}`
  if (a.tipo === 'link') return `🔗 ${a.nombre || 'Abrir link'}`
  if (a.tipo === 'foto') return '🖼️ Ver foto'
  if (a.tipo === 'audio') return '🔊 Escuchar audio'
  return `📄 ${a.nombre || 'Ver archivo'}`
}

export const tieneAdjuntos = (viaje, campo) => (viaje.adjuntos ?? []).some((a) => a.campo === campo)
