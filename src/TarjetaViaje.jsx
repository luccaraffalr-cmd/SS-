import { FORMAS_PAGO, NOMBRE_ESTADO_VIAJE, dinero, esAsignableSinChofer, fechaCorta, hora } from './viajes.js'

// Datos que necesita la tarjeta (se agregan al select de viajes).
export const CONSULTA_VIAJES = '*, chofer:perfiles!viajes_chofer_id_fkey(nombre),'
  + ' rechazo:perfiles!viajes_rechazado_por_fkey(nombre), fijo:perfiles!viajes_chofer_fijo_fkey(nombre),'
  + ' cuenta:cuentas_corrientes(nombre)'

// Cuándo se le ofrece el viaje al chofer fijo (7 días antes de la hora de asignación).
export function cuandoSeOfrece(v) {
  return new Date(new Date(v.hora_asignacion).getTime() - 7 * 24 * 60 * 60 * 1000)
}

// Un viaje en la lista o en el calendario de gestión.
export default function TarjetaViaje({ v, ahora, mostrarFecha, onAbrir }) {
  const urgente = esAsignableSinChofer(v, ahora) && !v.chofer_fijo
  const esperando = v.estado === 'sin_chofer' && !urgente
  const esperaFijo = v.estado === 'sin_chofer' && v.chofer_fijo
  // Asignado a mano por gestión (chofer elegido, reasignado o chofer fijo): en naranja.
  const fijo = (['ofrecido', 'asignado'].includes(v.estado) && v.asignado_por) || esperaFijo
  const etiqueta = esperaFijo ? 'Chofer fijo'
    : v.estado === 'sin_chofer' && v.espera_gestion ? 'Rechazado: decidir'
    : esperando ? `Se asigna ${hora(v.hora_asignacion)}`
    : v.estado === 'ofrecido' && !v.asignado_por ? `Ofrecido hace ${Math.max(0, Math.floor((ahora - new Date(v.asignado_en)) / 60000))} min`
    : v.estado === 'asignado' && !v.iniciado_en ? 'Aceptado'
    : v.estado === 'asignado' ? 'En viaje'
    : NOMBRE_ESTADO_VIAJE[v.estado]

  return (
    <button className={'tarjeta-viaje' + (urgente ? ' urgente' : '') + (fijo ? ' fijo' : '')
      + (v.estado === 'pago_pendiente' ? ' pago-pendiente' : '')}
      onClick={onAbrir}>
      <div className="viaje-arriba">
        <span className="viaje-hora">
          {v.prioritario && ['sin_chofer', 'ofrecido'].includes(v.estado) && '⭐ '}
          {v.tipo === 'programado' ? hora(v.hora_presentacion) : hora(v.hora_asignacion)}
          {mostrarFecha && <small> {fechaCorta(v.hora_asignacion)}</small>}
        </span>
        <span className={'etiqueta viaje ' + v.estado}>{etiqueta}</span>
      </div>
      <div className="viaje-ruta">
        {v.origen}{v.destino ? ' → ' + v.destino : ''}
      </div>
      <div className="viaje-abajo">
        <span>{v.viaje_fijo_id ? '🔁 Fijo' : v.tipo === 'programado' ? '📅 Programado' : '⚡ Inmediato'} · #{v.id}</span>
        <span>
          {v.chofer ? (fijo ? '📌 ' : '') + v.chofer.nombre
            : esperaFijo ? `📌 ${v.fijo?.nombre ?? ''} (se le ofrece el ${fechaCorta(cuandoSeOfrece(v))})`
            : v.espera_gestion && v.rechazo ? `❌ Lo rechazó ${v.rechazo.nombre}`
            : urgente ? '⚠️ Falta chofer' : ''}
        </span>
      </div>
      {(v.cliente_nombre || v.estado === 'finalizado') && (
        <div className="viaje-abajo">
          <span>{v.cliente_nombre}</span>
          {v.estado === 'finalizado' && (
            <span className="importe">
              {dinero(v.importe)} · {(v.cuenta?.nombre || v.cuenta_otro)
                ? `Cta. cte. ${v.cuenta?.nombre ?? v.cuenta_otro}` : FORMAS_PAGO[v.forma_pago]}
            </span>
          )}
        </div>
      )}
    </button>
  )
}
