import { useState } from 'react'
import { supabase } from './supabase.js'
import { textoError } from './estados.js'
import { cuando } from './viajes.js'
import FormPago from './FormPago.jsx'
import { useAtras } from './atras.js'

// Chofer: viajes hechos a los que les falta cargar el pago (pedido del 19/10/2026). Va abajo de todo de la pantalla,
// como un cartel que se despliega (igual que el de viajes sin chofer): "⏳ 3 viajes sin cargar" → al tocar se ven
// cuáles son, cada uno con su botón "Cargar pago". La lista la trae MisViajes (onSinPago).
export default function ViajesSinCargar({ viajes }) {
  const [abierto, setAbierto] = useState(false)
  const [cargandoPago, setCargandoPago] = useState(null) // id del viaje al que le está cargando el pago
  const [listos, setListos] = useState([]) // ya cargados (se sacan enseguida, sin esperar a que se actualice la lista)
  const pendientes = viajes.filter((v) => !listos.includes(v.id))

  // El botón atrás del celular hace lo mismo que "Volver" / cerrar el cartel.
  useAtras(abierto && pendientes.length > 0, () => setAbierto(false))
  useAtras(cargandoPago !== null, () => setCargandoPago(null))

  async function cargarPago(viaje, importe, forma_pago, cuenta, otro, extras) {
    const { error } = await supabase.rpc('cargar_pago', { viaje, importe, forma_pago, cuenta, otro, ...extras })
    if (error) return textoError(error)
    setCargandoPago(null)
    setListos([...listos, viaje])
  }

  if (pendientes.length === 0) return null
  const n = pendientes.length

  return (
    <div className="desplegable-sin-cargar">
      <button className="alerta-sin-chofer" onClick={() => setAbierto(!abierto)}>
        <strong>⏳ {n} {n === 1 ? 'viaje' : 'viajes'} sin cargar</strong>
        <span className="detalle">{abierto ? 'Tocá para cerrar' : 'Tocá para ver cuáles son y cargar el pago'}</span>
      </button>
      {abierto && (
        <div className="lista-sin-cargar">
          {pendientes.map((v) => (
            <div key={v.id} className="proximo">
              <strong className="viaje-titulo">{v.origen}</strong>
              {v.destino && <span>→ {v.destino}</span>}
              <span className="viaje-cuando">{cuando(v)} · #{v.id}</span>
              {cargandoPago === v.id ? (
                <FormPago textoBoton="Guardar pago"
                  onGuardar={(importe, forma, cuenta, otro, extras) => cargarPago(v.id, importe, forma, cuenta, otro, extras)}
                  onCancelar={() => setCargandoPago(null)} />
              ) : (
                <button className="boton verde" onClick={() => setCargandoPago(v.id)}>💵 Cargar pago</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
