import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { NOMBRE_ESTADO, haceCuanto, textoError } from './estados.js'
import { estaSinSenal, useConfiguracion } from './configuracion.js'

const ORDEN_ESTADO = { en_viaje: 0, en_cola: 1, yendo: 2, conectado: 3, desconectado: 4 }

// Gestión: la cola y todos los choferes con su estado, en tiempo real.
export default function Choferes() {
  const [lista, setLista] = useState(null)
  const [ahora, setAhora] = useState(Date.now())
  const [abierto, setAbierto] = useState(null) // chofer al que se le está cambiando el estado
  const [eligiendo, setEligiendo] = useState(false) // lista de "Agregar a la cola" abierta
  const [error, setError] = useState('')
  const { minutos_sin_senal } = useConfiguracion()

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

  async function llamar(funcion, parametros) {
    setError('')
    const { error } = await supabase.rpc(funcion, parametros)
    if (error) setError(textoError(error))
    else { setAbierto(null); setEligiendo(false); cargar() }
  }

  const cola = (lista ?? []).filter((c) => c.estado === 'en_cola')
    .sort((a, b) => new Date(a.anunciado_en) - new Date(b.anunciado_en))
  const paraAgregar = (lista ?? []).filter((c) => !c.oculto && c.estado !== 'en_cola' && c.estado !== 'en_viaje')
  const sinSenal = (lista ?? []).filter((c) => estaSinSenal(c, minutos_sin_senal, ahora))

  return (
    <main className="pantalla">
      {sinSenal.length > 0 && (
        <div className="alerta-sin-senal">
          <strong>⚠️ Sin señal</strong>
          {sinSenal.map((c) => (
            <div key={c.id} className="alerta-fila">
              <span>{c.perfiles.nombre} · {NOMBRE_ESTADO[c.estado]} · {haceCuanto(c.ultimo_reporte, ahora)}</span>
              {c.perfiles.telefono && <a className="boton-chico llamar" href={'tel:' + c.perfiles.telefono}>📞 Llamar</a>}
            </div>
          ))}
        </div>
      )}

      <h1>Cola</h1>
      {error && <p className="aviso error">{error}</p>}
      <section className="tarjeta">
        {lista !== null && cola.length === 0 && <p className="ayuda sin-margen">No hay nadie en la cola.</p>}
        <ol className="cola con-acciones">
          {cola.map((c, i) => (
            <li key={c.id}>
              <span><strong>{i + 1}.</strong> {c.perfiles.nombre}</span>
              <button className="boton-chico" onClick={() => llamar('salir_de_cola', { chofer: c.id })}>Sacar</button>
            </li>
          ))}
        </ol>
        <button className="boton" onClick={() => setEligiendo(!eligiendo)}>
          {eligiendo ? 'Cerrar' : '+ Agregar a la cola'}
        </button>
        {eligiendo && (
          <div className="elegir">
            {paraAgregar.length === 0 && <p className="ayuda sin-margen">No hay choferes para agregar.</p>}
            {paraAgregar.map((c) => (
              <button key={c.id} className="fila" onClick={() => llamar('agregar_a_cola', { chofer: c.id })}>
                <span><strong>{c.perfiles.nombre}</strong></span>
                <span className={'etiqueta estado ' + c.estado}>{NOMBRE_ESTADO[c.estado]}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <h1 className="titulo-seccion">Choferes</h1>
      {lista === null && <p>Cargando…</p>}
      {lista?.length === 0 && <p className="ayuda">Todavía no hay choferes. Crealos en la pestaña Usuarios.</p>}
      <ul className="lista">
        {lista?.map((c) => (
          <li key={c.id} className={'tarjeta-chofer' + (estaSinSenal(c, minutos_sin_senal, ahora) ? ' sin-senal' : '')}>
            <button className="fila" onClick={() => setAbierto(abierto === c.id ? null : c.id)}>
              <span>
                <strong>{c.perfiles.nombre}{c.oculto && <span className="etiqueta oculto">Oculto</span>}</strong>
                <small className="reporte">
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
                  <button key={e} className="boton secundario"
                    onClick={() => llamar('cambiar_estado_chofer', { chofer: c.id, nuevo: e })}>{NOMBRE_ESTADO[e]}</button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  )
}
