import { supabase } from './supabase.js'

// Tiene que coincidir con DOMINIO_USUARIOS en supabase/functions/usuarios/index.ts
const DOMINIO_USUARIOS = 'usuarios.remiseria.app'

// Los choferes pueden entrar con un usuario ("juan") en vez de un email.
export function aEmail(usuario) {
  const u = usuario.trim().toLowerCase()
  return u.includes('@') ? u : `${u}@${DOMINIO_USUARIOS}`
}

export const NOMBRE_ROL = { admin: 'Administrador', operador: 'Operador', chofer: 'Chofer' }

// Llama a la función del servidor que crea usuarios y cambia contraseñas.
export async function llamarFuncionUsuarios(datos) {
  const { data, error } = await supabase.functions.invoke('usuarios', { body: datos })
  if (error) {
    let mensaje = 'No se pudo completar la operación.'
    try { mensaje = (await error.context.json()).error ?? mensaje } catch { /* sin detalle */ }
    throw new Error(mensaje)
  }
  return data
}
