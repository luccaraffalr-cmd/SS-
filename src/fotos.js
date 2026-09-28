import { supabase } from './supabase.js'

// Dirección pública de una foto de auto guardada en Storage.
export function urlFotoAuto(ruta) {
  return ruta ? supabase.storage.from('autos').getPublicUrl(ruta).data.publicUrl : null
}

// Achica la foto antes de subirla (las del celular pesan varios MB).
export function achicarFoto(archivo, ladoMaximo = 1200) {
  return new Promise((resolver, rechazar) => {
    const img = new Image()
    img.onload = () => {
      const escala = Math.min(1, ladoMaximo / Math.max(img.width, img.height))
      const lienzo = document.createElement('canvas')
      lienzo.width = Math.round(img.width * escala)
      lienzo.height = Math.round(img.height * escala)
      lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height)
      URL.revokeObjectURL(img.src)
      lienzo.toBlob((blob) => (blob ? resolver(blob) : rechazar(new Error('No se pudo procesar la foto.'))),
        'image/jpeg', 0.85)
    }
    img.onerror = () => rechazar(new Error('Ese archivo no parece una foto.'))
    img.src = URL.createObjectURL(archivo)
  })
}
