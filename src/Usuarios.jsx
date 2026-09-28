import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { NOMBRE_ROL, llamarFuncionUsuarios } from './usuarios.js'

const ORDEN_ROL = { admin: 0, operador: 1, chofer: 2 }

// Lista de usuarios (solo admin): crear, editar datos, rol, activar/desactivar y contraseña.
export default function Usuarios({ yo }) {
  const [lista, setLista] = useState(null)
  const [editando, setEditando] = useState(null) // null = lista; 'nuevo' = alta; objeto = edición

  async function cargar() {
    const { data } = await supabase.from('perfiles').select('*')
    setLista((data ?? []).sort((a, b) =>
      (b.activo - a.activo) || (ORDEN_ROL[a.rol] - ORDEN_ROL[b.rol]) || a.nombre.localeCompare(b.nombre)))
  }
  useEffect(() => { cargar() }, [])

  function volver() { setEditando(null); cargar() }

  if (editando === 'nuevo') return <NuevoUsuario onListo={volver} />
  if (editando) return <EditarUsuario perfil={editando} esYo={editando.id === yo.id} onListo={volver} />

  return (
    <main className="pantalla">
      <h1>Usuarios</h1>
      <button className="boton" onClick={() => setEditando('nuevo')}>+ Nuevo usuario</button>
      {lista === null && <p>Cargando…</p>}
      <ul className="lista">
        {lista?.map((p) => (
          <li key={p.id}>
            <button className={'fila' + (p.activo ? '' : ' inactivo')} onClick={() => setEditando(p)}>
              <span>
                <strong>{p.nombre}</strong>
                <small>{p.usuario}{p.telefono ? ' · ' + p.telefono : ''}</small>
              </span>
              <span className={'etiqueta ' + p.rol}>{p.activo ? NOMBRE_ROL[p.rol] : 'Desactivado'}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}

function NuevoUsuario({ onListo }) {
  const [datos, setDatos] = useState({ nombre: '', telefono: '', usuario: '', clave: '', rol: 'chofer' })
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const cambiar = (campo) => (e) => setDatos({ ...datos, [campo]: e.target.value })

  async function guardar(e) {
    e.preventDefault()
    setError('')
    setEnviando(true)
    try {
      await llamarFuncionUsuarios({ accion: 'crear', ...datos })
      onListo()
    } catch (err) {
      setError(err.message)
      setEnviando(false)
    }
  }

  return (
    <main className="pantalla">
      <h1>Nuevo usuario</h1>
      <form className="tarjeta" onSubmit={guardar}>
        <label>Nombre<input value={datos.nombre} onChange={cambiar('nombre')} required /></label>
        <label>Teléfono<input type="tel" value={datos.telefono} onChange={cambiar('telefono')} /></label>
        <label>
          Rol
          <select value={datos.rol} onChange={cambiar('rol')}>
            <option value="chofer">Chofer</option>
            <option value="operador">Operador</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <label>
          Usuario para entrar
          <input value={datos.usuario} onChange={cambiar('usuario')} required
            autoCapitalize="none" autoCorrect="off" placeholder="ej: juanperez" />
          <small className="ayuda">Sin espacios ni acentos. También puede ser un email.</small>
        </label>
        <label>
          Contraseña
          <input value={datos.clave} onChange={cambiar('clave')} required minLength={6}
            autoCapitalize="none" autoCorrect="off" autoComplete="new-password" />
          <small className="ayuda">Mínimo 6 caracteres. Pasásela a la persona por WhatsApp.</small>
        </label>
        {error && <p className="aviso error">{error}</p>}
        <button className="boton" disabled={enviando}>{enviando ? 'Creando…' : 'Crear usuario'}</button>
        <button type="button" className="boton secundario" onClick={onListo}>Cancelar</button>
      </form>
    </main>
  )
}

function EditarUsuario({ perfil, esYo, onListo }) {
  const [datos, setDatos] = useState({
    nombre: perfil.nombre, telefono: perfil.telefono ?? '', rol: perfil.rol, activo: perfil.activo,
  })
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)
  const cambiar = (campo) => (e) => setDatos({ ...datos, [campo]: e.target.value })

  async function guardar(e) {
    e.preventDefault()
    setError('')
    setEnviando(true)
    const { error } = await supabase.from('perfiles').update({
      nombre: datos.nombre.trim(), telefono: datos.telefono.trim() || null, rol: datos.rol, activo: datos.activo,
    }).eq('id', perfil.id)
    setEnviando(false)
    if (error) setError('No se pudo guardar: ' + error.message)
    else onListo()
  }

  async function cambiarClave() {
    setError('')
    setMensaje('')
    try {
      await llamarFuncionUsuarios({ accion: 'cambiar_clave', id: perfil.id, clave })
      setClave('')
      setMensaje('Contraseña cambiada ✅')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <main className="pantalla">
      <h1>{perfil.nombre}</h1>
      <p className="ayuda">Usuario para entrar: <strong>{perfil.usuario}</strong></p>
      <form className="tarjeta" onSubmit={guardar}>
        <label>Nombre<input value={datos.nombre} onChange={cambiar('nombre')} required /></label>
        <label>Teléfono<input type="tel" value={datos.telefono} onChange={cambiar('telefono')} /></label>
        <label>
          Rol
          <select value={datos.rol} onChange={cambiar('rol')} disabled={esYo}>
            <option value="chofer">Chofer</option>
            <option value="operador">Operador</option>
            <option value="admin">Administrador</option>
          </select>
          {esYo && <small className="ayuda">No podés cambiar tu propio rol.</small>}
        </label>
        {!esYo && (
          <label className="casilla">
            <input type="checkbox" checked={datos.activo}
              onChange={(e) => setDatos({ ...datos, activo: e.target.checked })} />
            Activo (si lo desmarcás, no puede entrar a la app)
          </label>
        )}
        {error && <p className="aviso error">{error}</p>}
        <button className="boton" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="boton secundario" onClick={onListo}>Volver</button>
      </form>

      <div className="tarjeta separada">
        <label>
          Nueva contraseña
          <input value={clave} onChange={(e) => setClave(e.target.value)} minLength={6}
            autoCapitalize="none" autoCorrect="off" autoComplete="new-password" />
        </label>
        {mensaje && <p className="aviso ok">{mensaje}</p>}
        <button type="button" className="boton secundario" disabled={clave.length < 6} onClick={cambiarClave}>
          Cambiar contraseña
        </button>
      </div>
    </main>
  )
}
