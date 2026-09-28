import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { NOMBRE_ESTADO, haceCuanto, textoError } from './estados.js'

const ORDEN_ESTADO = { en_viaje: 0, en_cola: 1, yendo: 2, conectado: 3, desconectado: 4 }

// Gestión: todos los choferes con su estado, en tiempo real.
export default function Choferes() {
  const [lista, setLista] = useState(null)
  const [ahora, setAhora] = useState(Date.now())
  const [abierto, setAbierto] = useState(null) // chofer al que se le está cambiando el estado
  const [error, setError] = useState('')

  async function cargar() {
    const { data } = await supabase.from('choferes').select('*, perfiles(nombre, telefono, activo)')
    setLista((data ?? [])
      .filter((c) => c.perfiles?.activo)
      .sort((a, b) => (ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]) || a.perfiles.nombre.localeCompare(b.perfiles.nombre)))
  }

  useEffect(() => {
    cargar()
    const canal = supabase.channel('gestion-choferes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'choferes' }, cargar)
      .subscribe()
    const reloj = setInterval(() => setAhora(Date.now()), 30 * 1000)
    return () => { supabase.removeChannel(canal); clearInterval(reloj) }
  }, [])

  async function cambiar(chofer, nuevo) {
    setError('')
    const { error } = await supabase.rpc('cambiar_estado_chofer', { chofer: chofer.id, nuevo })
    if (error) setError(textoError(error))
    else { setAbierto(null); cargar() }
  }

  return (
    <main className="pantalla">
      <h1>Choferes</h1>
      {lista === null && <p>Cargando…</p>}
      {lista?.length === 0 && <p className="ayuda">Todavía no hay choferes. Crealos en la pestaña Usuarios.</p>}
      {error && <p className="aviso error">{error}</p>}
      <ul className="lista">
        {lista?.map((c) => (
          <li key={c.id} className="tarjeta-chofer">
            <button className="fila" onClick={() => setAbierto(abierto === c.id ? null : c.id)}>
              <span>
                <strong>{c.perfiles.nombre}{c.oculto && <span className="etiqueta oculto">Oculto</span>}</strong>
                <small>
                  Último reporte: {haceCuanto(c.ultimo_reporte, ahora)}
                  {c.patente ? ' · ' + c.patente : ''}
                </small>
              </span>
              <span className={'etiqueta estado ' + c.estado}>{NOMBRE_ESTADO[c.estado]}</span>
            </button>
            {abierto === c.id && (
              <div className="acciones">
                {c.perfiles.telefono && <a className="boton secundario" href={'tel:' + c.perfiles.telefono}>📞 Llamar</a>}
                <p className="ayuda">Cambiar estado a:</p>
                {['conectado', 'yendo', 'desconectado'].filter((e) => e !== c.estado).map((e) => (
                  <button key={e} className="boton secundario" onClick={() => cambiar(c, e)}>{NOMBRE_ESTADO[e]}</button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  )
}
