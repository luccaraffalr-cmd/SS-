// Función del servidor para crear usuarios y cambiarles la contraseña.
// Solo la puede usar un admin. Necesita la clave secreta de Supabase,
// que acá está disponible sin que nadie la tenga que copiar.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Los choferes pueden entrar con un "usuario" en vez de email.
// Por dentro se guarda como <usuario>@DOMINIO_USUARIOS (no recibe mails).
const DOMINIO_USUARIOS = 'usuarios.remiseria.app'
const ROLES = ['admin', 'operador', 'chofer']

function respuesta(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function aEmail(usuario: string) {
  const u = usuario.trim().toLowerCase()
  return u.includes('@') ? u : `${u}@${DOMINIO_USUARIOS}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // ¿Quién llama? Tiene que ser un admin activo.
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  const { data: quien } = await admin.auth.getUser(token)
  if (!quien?.user) return respuesta({ error: 'No iniciaste sesión.' }, 401)
  const { data: perfilQuien } = await admin.from('perfiles').select('rol, activo').eq('id', quien.user.id).maybeSingle()
  if (perfilQuien?.rol !== 'admin' || !perfilQuien.activo) {
    return respuesta({ error: 'Solo el administrador puede hacer esto.' }, 403)
  }

  let datos: Record<string, string>
  try { datos = await req.json() } catch { return respuesta({ error: 'Datos inválidos.' }, 400) }

  if (datos.accion === 'crear') {
    const { usuario, clave, nombre, telefono, rol } = datos
    if (!usuario?.trim() || !nombre?.trim() || !ROLES.includes(rol)) {
      return respuesta({ error: 'Faltan datos (usuario, nombre o rol).' }, 400)
    }
    if (!usuario.includes('@') && !/^[a-z0-9._-]+$/i.test(usuario.trim())) {
      return respuesta({ error: 'El usuario solo puede tener letras, números, punto, guion o guion bajo (sin espacios ni acentos).' }, 400)
    }
    if (!clave || clave.length < 6) return respuesta({ error: 'La contraseña tiene que tener al menos 6 caracteres.' }, 400)

    const { data: creado, error } = await admin.auth.admin.createUser({
      email: aEmail(usuario), password: clave, email_confirm: true,
    })
    if (error) {
      const yaExiste = /already|registered|exists/i.test(error.message)
      return respuesta({ error: yaExiste ? 'Ese usuario ya existe.' : error.message }, 400)
    }

    const { error: errorPerfil } = await admin.from('perfiles').insert({
      id: creado.user.id, usuario: usuario.trim().toLowerCase(), rol,
      nombre: nombre.trim(), telefono: telefono?.trim() || null,
    })
    if (errorPerfil) {
      await admin.auth.admin.deleteUser(creado.user.id) // no dejar usuarios a medias
      return respuesta({ error: errorPerfil.message }, 400)
    }
    return respuesta({ ok: true, id: creado.user.id })
  }

  if (datos.accion === 'cambiar_clave') {
    const { id, clave } = datos
    if (!id) return respuesta({ error: 'Falta el usuario.' }, 400)
    if (!clave || clave.length < 6) return respuesta({ error: 'La contraseña tiene que tener al menos 6 caracteres.' }, 400)
    const { error } = await admin.auth.admin.updateUserById(id, { password: clave })
    if (error) return respuesta({ error: error.message }, 400)
    return respuesta({ ok: true })
  }

  return respuesta({ error: 'Acción desconocida.' }, 400)
})
