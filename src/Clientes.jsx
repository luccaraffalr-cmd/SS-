import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { useAtras } from './atras.js'
import { CONSULTA_CLIENTES, buscarClientes, cantidadDeViajes, normalizar, viajesDeSiempre } from './clientes.js'
import { AvisoTelefono, textoViajes } from './ElegirCliente.jsx'
import { NOMBRE_ESTADO_VIAJE, fechaCorta, hora } from './viajes.js'
import FormViaje from './FormViaje.jsx'

const VACIO = { nombre: '', telefono: '', nota: '', cuenta_id: '' }
const fechaDelViaje = (v) => `${fechaCorta(v.hora_presentacion ?? v.creado_en)} ${hora(v.hora_presentacion ?? v.creado_en)}`

// Gestión: clientes guardados (2/11/2026, SQL 050). Se crean solo acá, a mano; en los viajes se eligen con el buscador.
// Cada uno tiene teléfono (para mandarle el link por WhatsApp), nota fija y cuenta corriente; sus viajes de siempre
// salen solos de sus viajes.
export default function Clientes({ esAdmin }) {
  const [lista, setLista] = useState(null)
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(null) // null = lista; objeto = ficha (sin id = cliente nuevo)
  const [viajePara, setViajePara] = useState(null) // cliente al que se le está cargando un viaje

  async function cargar() {
    const { data } = await supabase.from('clientes').select(CONSULTA_CLIENTES).order('nombre')
    setLista(data ?? [])
  }
  useEffect(() => { cargar() }, [])
  const volver = () => { setAbierto(null); cargar() }
  // El botón atrás del celular hace lo mismo que "Volver".
  useAtras(!!abierto && !viajePara, volver)
  useAtras(!!viajePara, () => setViajePara(null))

  if (viajePara) {
    return <FormViaje inicial={{ cliente: viajePara }} esAdmin={esAdmin}
      onListo={() => setViajePara(null)} onVolver={() => setViajePara(null)} />
  }
  if (abierto) return <FichaCliente cliente={abierto} clientes={lista ?? []} onListo={volver} onNuevoViaje={setViajePara} />

  const mostrados = normalizar(texto).length >= 2 ? buscarClientes(lista ?? [], texto, Infinity) : lista

  return (
    <main className="pantalla">
      <h1>Clientes</h1>
      <p className="ayuda">
        Los clientes guardados se eligen al cargar un viaje: se completan su teléfono y su nota, y aparecen sus viajes de
        siempre. Si tiene cuenta corriente, al chofer le aparece ya elegida al cobrar.
      </p>
      <button className="boton" onClick={() => setAbierto(VACIO)}>➕ Nuevo cliente</button>
      <input className="buscador-clientes separada" type="search" value={texto} onChange={(e) => setTexto(e.target.value)}
        placeholder="🔍 Buscar por nombre o teléfono" autoComplete="off" />
      {lista === null && <p>Cargando…</p>}
      {lista?.length === 0 && <p className="ayuda separada">Todavía no hay clientes.</p>}
      {lista?.length > 0 && mostrados.length === 0 && <p className="ayuda separada">No hay ningún cliente así.</p>}
      <ul className="lista">
        {mostrados?.map((c) => (
          <li key={c.id}>
            <button className="fila" onClick={() => setAbierto(c)}>
              <span>
                <strong>{c.nombre}</strong>
                {c.telefono && <small>📞 {c.telefono}</small>}
                {c.cuenta && <small>💳 {c.cuenta.nombre}</small>}
              </span>
              <span className="etiqueta">{textoViajes(cantidadDeViajes(c))}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}

// Ficha de un cliente: sus datos, sus viajes, cargarle un viaje, juntarlo con otro (repetidos) o borrarlo.
function FichaCliente({ cliente, clientes, onListo, onNuevoViaje }) {
  const esNuevo = !cliente.id
  const [datos, setDatos] = useState(() => ({
    nombre: cliente.nombre, telefono: cliente.telefono ?? '', nota: cliente.nota ?? '', cuenta_id: cliente.cuenta_id ?? '',
  }))
  const [cuentas, setCuentas] = useState([])
  const [viajes, setViajes] = useState(null)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [juntando, setJuntando] = useState(false) // buscando el repetido
  const [buscarOtro, setBuscarOtro] = useState('')
  const [otro, setOtro] = useState(null) // el repetido elegido (se pregunta antes de juntar)
  const [confirmandoBorrar, setConfirmandoBorrar] = useState(false)
  const cambiar = (campo) => (e) => setDatos({ ...datos, [campo]: e.target.value })

  useAtras(juntando, () => { setJuntando(false); setOtro(null) })
  useAtras(confirmandoBorrar, () => setConfirmandoBorrar(false))

  useEffect(() => {
    // Las cuentas activas, más la que ya tiene (aunque esté desactivada).
    supabase.from('cuentas_corrientes').select('id, nombre, activo').order('nombre')
      .then(({ data }) => setCuentas((data ?? []).filter((c) => c.activo || c.id === cliente.cuenta_id)))
    if (esNuevo) return
    supabase.from('viajes').select('id, estado, tipo, origen, destino, hora_presentacion, creado_en')
      .eq('cliente_id', cliente.id).neq('estado', 'anulado').order('creado_en', { ascending: false }).limit(100)
      .then(({ data }) => setViajes(data ?? []))
  }, [cliente.id, cliente.cuenta_id, esNuevo])

  const repetido = clientes.find((c) => c.id !== cliente.id && normalizar(c.nombre) === normalizar(datos.nombre))
  const candidatos = buscarClientes(clientes.filter((c) => c.id !== cliente.id), buscarOtro)
  const deSiempre = viajesDeSiempre(viajes ?? [])

  async function guardar(e) {
    e.preventDefault()
    setError('')
    const fila = {
      nombre: datos.nombre.trim().replace(/\s+/g, ' '),
      telefono: datos.telefono.trim() || null,
      nota: datos.nota.trim() || null,
      cuenta_id: datos.cuenta_id ? Number(datos.cuenta_id) : null,
    }
    if (!fila.nombre) return setError('Escribí el nombre.')
    setEnviando(true)
    const { error } = esNuevo
      ? await supabase.from('clientes').insert(fila)
      : await supabase.from('clientes').update(fila).eq('id', cliente.id)
    setEnviando(false)
    if (error) setError('No se pudo guardar: ' + error.message)
    else onListo()
  }

  async function juntar() {
    setError('')
    setEnviando(true)
    const { error } = await supabase.rpc('juntar_clientes', { p_queda: cliente.id, p_se_va: otro.id })
    setEnviando(false)
    if (error) setError('No se pudo juntar: ' + error.message)
    else onListo()
  }

  async function borrar() {
    setError('')
    setEnviando(true)
    const { error } = await supabase.from('clientes').delete().eq('id', cliente.id)
    setEnviando(false)
    if (error) setError('No se pudo borrar: ' + error.message)
    else onListo()
  }

  return (
    <main className="pantalla">
      <h1>{esNuevo ? 'Nuevo cliente' : cliente.nombre}</h1>
      <form className="tarjeta formulario-apretado" onSubmit={guardar}>
        <label>
          Nombre
          <input value={datos.nombre} onChange={cambiar('nombre')} required placeholder="ej: Juan Pérez" />
          {repetido && (
            <small className="ayuda texto-alerta">
              Ya hay un cliente que se llama así ({repetido.nombre}). Si es el mismo, usá ese.
            </small>
          )}
        </label>
        <label>
          Teléfono
          <input type="tel" value={datos.telefono} onChange={cambiar('telefono')} placeholder="ej: 11 5555-1234" />
          <AvisoTelefono telefono={datos.telefono} />
        </label>
        <label>
          Nota fija (opcional)
          <textarea rows={2} value={datos.nota} onChange={cambiar('nota')} placeholder="ej: va con silla de ruedas" />
          <small className="ayuda">Se agrega sola a Observaciones cuando lo elegís en un viaje.</small>
        </label>
        <label>
          Cuenta corriente
          <select value={datos.cuenta_id} onChange={cambiar('cuenta_id')}>
            <option value="">No tiene (paga en el viaje)</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <small className="ayuda">Si tiene, al cobrar al chofer le aparece ya elegida (y la puede cambiar a efectivo).</small>
        </label>
        {error && !otro && !confirmandoBorrar && <p className="aviso error">{error}</p>}
        <button className="boton" disabled={enviando}>{enviando ? 'Guardando…' : esNuevo ? 'Guardar cliente' : 'Guardar cambios'}</button>
        <button type="button" className="boton secundario" onClick={onListo}>Volver</button>
      </form>

      {!esNuevo && (
        <>
          <button className="boton azul-oscuro separada" onClick={() => onNuevoViaje(cliente)}>
            ➕ Nuevo viaje para {cliente.nombre}
          </button>

          <div className="tarjeta separada">
            <h2>Sus viajes</h2>
            {viajes === null && <p className="sin-margen">Cargando…</p>}
            {viajes?.length === 0 && <p className="ayuda sin-margen">Todavía no tiene viajes.</p>}
            {deSiempre.length > 0 && (
              <div>
                <p className="etiqueta-campo">De siempre</p>
                <ul className="lista-elegir">
                  {deSiempre.map((r) => (
                    <li key={r.origen + '→' + r.destino} className="proximo">
                      <span>{r.origen}{r.destino && <> → {r.destino}</>}</span>
                      <small className="ayuda sin-margen">{r.veces === 1 ? '1 vez' : `${r.veces} veces`}</small>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {viajes?.length > 0 && (
              <div>
                <p className="etiqueta-campo">Últimos</p>
                <ul className="lista-elegir">
                  {viajes.slice(0, 10).map((v) => (
                    <li key={v.id} className="proximo">
                      <span>{fechaDelViaje(v)} · #{v.id} · {NOMBRE_ESTADO_VIAJE[v.estado]}</span>
                      <small className="ayuda sin-margen">{v.origen}{v.destino && <> → {v.destino}</>}</small>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="tarjeta separada">
            {!juntando ? (
              <button type="button" className="boton secundario" onClick={() => setJuntando(true)}>
                🔗 Juntar con otro cliente (está repetido)
              </button>
            ) : !otro ? (
              <>
                <label>
                  ¿Con cuál? Buscalo
                  <input value={buscarOtro} onChange={(e) => setBuscarOtro(e.target.value)} autoComplete="off"
                    placeholder="Nombre o teléfono" />
                </label>
                {candidatos.length > 0 && (
                  <ul className="lista-elegir">
                    {candidatos.map((c) => (
                      <li key={c.id}>
                        <button type="button" className="opcion-viaje" onClick={() => setOtro(c)}>
                          <strong>👤 {c.nombre}</strong>
                          <small>{[c.telefono, textoViajes(cantidadDeViajes(c))].filter(Boolean).join(' · ')}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" className="boton secundario" onClick={() => setJuntando(false)}>Volver</button>
              </>
            ) : (
              <>
                <p className="sin-margen">
                  ¿Juntás a <strong>{otro.nombre}</strong> con <strong>{cliente.nombre}</strong>? Queda {cliente.nombre} con
                  los viajes de los dos ({textoViajes(cantidadDeViajes(otro))} de {otro.nombre}) y {otro.nombre} se borra.
                  Si a {cliente.nombre} le falta el teléfono, la nota o la cuenta, se toman de {otro.nombre}.
                </p>
                <button type="button" className="boton" disabled={enviando} onClick={juntar}>Sí, juntarlos</button>
                <button type="button" className="boton secundario" onClick={() => setOtro(null)}>No, elegir otro</button>
              </>
            )}
            {!confirmandoBorrar ? (
              <button type="button" className="boton peligro" onClick={() => setConfirmandoBorrar(true)}>Borrar cliente</button>
            ) : (
              <>
                <p className="sin-margen">
                  ¿Seguro que querés borrar a <strong>{cliente.nombre}</strong>? Sus viajes quedan como están (con el nombre
                  escrito), pero ya no se lo puede elegir en un viaje nuevo.
                </p>
                <button type="button" className="boton peligro" disabled={enviando} onClick={borrar}>Sí, borrar</button>
                <button type="button" className="boton secundario" onClick={() => setConfirmandoBorrar(false)}>No</button>
              </>
            )}
            {error && (otro || confirmandoBorrar) && <p className="aviso error">{error}</p>}
          </div>
        </>
      )}
    </main>
  )
}
