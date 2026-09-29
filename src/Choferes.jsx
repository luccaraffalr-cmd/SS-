import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'
import { NOMBRE_ESTADO, haceCuanto, textoError } from './estados.js'
import ColaOrdenable from './ColaOrdenable.jsx'
import { sinSenal } from './mapa.js'

const ORDEN_ESTADO = { en_viaje: 0, en_cola: 1, libre: 2, fuera_de_servicio: 3 }

// Gestión: la cola (ordenable) y todos los choferes con su estado, en tiempo real.
export default function Choferes() {
  const [lista, setLista] = useState(null)
  const [ahora, setAhora] = useState(Date.now())
  const [abierto, setAbierto] = useState(null) // chofer al que se le está cambiando el estado
  const [eligiendo, setEligiendo] = useState(false) // lista de "Agregar a la cola" abierta
  const [error, setError] = useState('')
  const [ubicaciones, setUbicaciones] = useState({}) // equipo de Traccar -> última ubicación

  async function cargarUbicaciones() {
    const { data } = await supabase.from('ubicaciones').select('equipo, reportado_en')
    setUbicaciones(Object.fromEntries((data ?? []).map((u) => [u.equipo, u.reportado_en])))
  }

  async function cargar() {
    const { data } = await supabase.from('choferes').select('*, perfiles(nombre, telefono, activo)')
    setLista((data ?? [])
      .filter((c) => c.perfiles?.activo)
      .sort((a, b) => (ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]) || a.perfiles.nombre.localeCompare(b.perfiles.nombre)))
  }

  useEffect(() => {
    cargar()
    cargarUbicaciones()
    const canal = supabase.channel('gestion-choferes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'choferes' }, cargar)
      .subscribe()
    const reloj = setInterval(() => { setAhora(Date.now()); cargarUbicaciones() }, 30 * 1000)
    return () => { supabase.removeChannel(canal); clearInterval(reloj) }
  }, [])

  async function llamar(funcion, parametros) {
    setError('')
    const { error } = await supabase.rpc(funcion, parametros)
    if (error) { setError(textoError(error)); cargar() }
    else { setAbierto(null); setEligiendo(false); cargar() }
  }

  const cola = useMemo(() => (lista ?? []).filter((c) => c.estado === 'en_cola')
    .sort((a, b) => new Date(a.anunciado_en) - new Date(b.anunciado_en)), [lista])
  const paraAgregar = (lista ?? []).filter((c) => !c.oculto && c.estado !== 'en_cola' && c.estado !== 'en_viaje')

  return (
    <main className="pantalla">
      <h1>Cola</h1>
      {error && <p className="aviso error">{error}</p>}
      <section className="tarjeta">
        {lista !== null && cola.length === 0 && <p className="ayuda sin-margen">No hay nadie en la cola.</p>}
        {cola.length > 1 && <p className="ayuda sin-margen">Para cambiar el orden, arrastrá la manija ≡.</p>}
        <ColaOrdenable
          cola={cola}
          onMover={(chofer, puesto) => llamar('mover_en_cola', { chofer, puesto })}
          onSacar={(chofer) => llamar('salir_de_cola', { chofer })}
        />
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
          <li key={c.id} className="tarjeta-chofer">
            <button className="fila" onClick={() => setAbierto(abierto === c.id ? null : c.id)}>
              <span>
                <strong>{c.perfiles.nombre}{c.oculto && <span className="etiqueta oculto">Oculto</span>}</strong>
                <small>
                  Último reporte: {haceCuanto(c.ultimo_reporte, ahora)}
                  {c.patente ? ' · ' + c.patente : ''}
                </small>
                {c.equipo_traccar && (
                  <small className={ubicaciones[c.equipo_traccar] && sinSenal(ubicaciones[c.equipo_traccar], ahora) ? 'texto-alerta' : ''}>
                    📍 Ubicación: {haceCuanto(ubicaciones[c.equipo_traccar], ahora)}
                  </small>
                )}
              </span>
              <span className={'etiqueta estado ' + c.estado}>{NOMBRE_ESTADO[c.estado]}</span>
            </button>
            {abierto === c.id && (
              <div className="acciones">
                {c.perfiles.telefono && <a className="boton secundario" href={'tel:' + c.perfiles.telefono}>📞 Llamar</a>}
                {c.estado !== 'en_viaje' && <p className="ayuda">Cambiar estado a:</p>}
                {c.estado !== 'en_viaje' && ['libre', 'fuera_de_servicio'].filter((e) => e !== c.estado).map((e) => (
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
