import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

const TIPOS = { empresa: 'Empresa', cliente: 'Cliente' }
const VACIA = { nombre: '', tipo: 'empresa', telefono: '', activo: true }

// Lista de cuentas corrientes (solo admin). Saldos y pagos: Etapa 3.
export default function CuentasCorrientes() {
  const [lista, setLista] = useState(null)
  const [editando, setEditando] = useState(null) // null = lista; objeto = alta (sin id) o edición

  async function cargar() {
    const { data } = await supabase.from('cuentas_corrientes').select('*').order('activo', { ascending: false }).order('nombre')
    setLista(data ?? [])
  }
  useEffect(() => { cargar() }, [])

  if (editando) return <FormCuenta cuenta={editando} onListo={() => { setEditando(null); cargar() }} />

  return (
    <main className="pantalla">
      <h1>Cuentas corrientes</h1>
      <p className="ayuda">Clientes y empresas a los que se les puede cargar un viaje "a cuenta". Los saldos llegan en la Etapa 3.</p>
      <button className="boton" onClick={() => setEditando(VACIA)}>+ Nueva cuenta</button>
      {lista === null && <p>Cargando…</p>}
      {lista?.length === 0 && <p className="ayuda">Todavía no hay cuentas.</p>}
      <ul className="lista">
        {lista?.map((c) => (
          <li key={c.id}>
            <button className={'fila' + (c.activo ? '' : ' inactivo')} onClick={() => setEditando(c)}>
              <span>
                <strong>{c.nombre}</strong>
                {c.telefono && <small>{c.telefono}</small>}
              </span>
              <span className="etiqueta">{c.activo ? TIPOS[c.tipo] : 'Desactivada'}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}

function FormCuenta({ cuenta, onListo }) {
  const esNueva = !cuenta.id
  const [datos, setDatos] = useState({ ...cuenta, telefono: cuenta.telefono ?? '' })
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const cambiar = (campo) => (e) => setDatos({ ...datos, [campo]: e.target.value })

  async function guardar(e) {
    e.preventDefault()
    setError('')
    setEnviando(true)
    const fila = { nombre: datos.nombre.trim(), tipo: datos.tipo, telefono: datos.telefono.trim() || null, activo: datos.activo }
    const { error } = esNueva
      ? await supabase.from('cuentas_corrientes').insert(fila)
      : await supabase.from('cuentas_corrientes').update(fila).eq('id', cuenta.id)
    setEnviando(false)
    if (error) setError(error.code === '23505' ? 'Ya hay una cuenta con ese nombre.' : 'No se pudo guardar: ' + error.message)
    else onListo()
  }

  return (
    <main className="pantalla">
      <h1>{esNueva ? 'Nueva cuenta corriente' : cuenta.nombre}</h1>
      <form className="tarjeta" onSubmit={guardar}>
        <label>Nombre<input value={datos.nombre} onChange={cambiar('nombre')} required placeholder="ej: Clínica San Juan" /></label>
        <label>
          Tipo
          <select value={datos.tipo} onChange={cambiar('tipo')}>
            <option value="empresa">Empresa</option>
            <option value="cliente">Cliente</option>
          </select>
        </label>
        <label>Teléfono<input type="tel" value={datos.telefono} onChange={cambiar('telefono')} /></label>
        {!esNueva && (
          <label className="casilla">
            <input type="checkbox" checked={datos.activo} onChange={(e) => setDatos({ ...datos, activo: e.target.checked })} />
            Activa (si la desmarcás, no aparece para elegir en los viajes nuevos)
          </label>
        )}
        {error && <p className="aviso error">{error}</p>}
        <button className="boton" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="boton secundario" onClick={onListo}>Volver</button>
      </form>
    </main>
  )
}
