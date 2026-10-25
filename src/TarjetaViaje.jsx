import {
  FORMAS_PAGO, NOMBRE_ESTADO_VIAJE, dinero, fechaCorta, hora, problemaDelViaje, recorridoDebajo, tituloViaje, totalCobrado,
} from './viajes.js'

// Datos que necesita la tarjeta (se agregan al select de viajes).
export const CONSULTA_VIAJES = '*, chofer:perfiles!viajes_chofer_id_fkey(nombre, telefono),'
  + ' rechazo:perfiles!viajes_rechazado_por_fkey(nombre), fijo:perfiles!viajes_chofer_fijo_fkey(nombre),'
  + ' cuenta:cuentas_corrientes(nombre), aprobador:perfiles!viajes_aprobado_por_fkey(nombre)'

// ¿Este viaje tiene el pago para aprobar? (finalizado y todavía sin aprobar; 24/10/2026)
export const paraAprobar = (v) => v.estado === 'finalizado' && !v.aprobado_en

// Cuándo se le ofrece el viaje al chofer fijo (7 días antes de la hora de asignación).
export function cuandoSeOfrece(v) {
  return new Date(new Date(v.hora_asignacion).getTime() - 7 * 24 * 60 * 60 * 1000)
}

// Un viaje en la lista o en el calendario de gestión. Con onTickear (lista, admins), los finalizados sin aprobar tienen un
// tick a la derecha para elegirlos y aprobar el pago (elegido = tickeado).
export default function TarjetaViaje({ v, ahora, mostrarFecha, onAbrir, onTickear, elegido }) {
  // En rojo: llegó la hora y no tiene chofer, no lo aceptó o no salió (ver problemaDelViaje).
  const problema = problemaDelViaje(v, ahora)
  const urgente = !!problema
  const esperando = v.estado === 'sin_chofer' && !urgente
  const esperaFijo = v.estado === 'sin_chofer' && v.chofer_fijo
  // Asignado a mano por gestión (chofer elegido, reasignado o chofer fijo): en naranja.
  const fijo = (['ofrecido', 'asignado'].includes(v.estado) && v.asignado_por) || esperaFijo
  const etiqueta = problema === 'no_salio' ? '⚠️ No salió'
    : problema === 'sin_aceptar' ? '⚠️ Sin aceptar'
    : esperaFijo ? 'Chofer fijo'
    : v.estado === 'sin_chofer' && v.espera_gestion ? 'Rechazado: decidir'
    : esperando ? `Se asigna ${hora(v.hora_asignacion)}`
    : v.estado === 'ofrecido' && !v.asignado_por ? `Ofrecido hace ${Math.max(0, Math.floor((ahora - new Date(v.asignado_en)) / 60000))} min`
    : v.estado === 'asignado' && !v.iniciado_en ? 'Aceptado'
    : v.estado === 'asignado' ? 'En viaje'
    : v.estado === 'finalizado' && v.aprobado_en ? '✅ Aprobado'
    : NOMBRE_ESTADO_VIAJE[v.estado]
  const conTick = !!onTickear && paraAprobar(v)

  const tarjeta = (
    <button className={'tarjeta-viaje' + (urgente ? ' urgente' : fijo ? ' fijo' : '')
      + (v.estado === 'pago_pendiente' ? ' pago-pendiente' : '') + (elegido ? ' elegido' : '')}
      onClick={onAbrir}>
      <div className="viaje-arriba">
        <span className="viaje-titulo">
          {v.prioritario && ['sin_chofer', 'ofrecido'].includes(v.estado) && '⭐ '}
          {tituloViaje(v)}
        </span>
        {conTick
          ? <span className="lugar-tick" />
          : <span className={'etiqueta viaje ' + v.estado + (v.aprobado_en ? ' aprobado' : '')}>{etiqueta}</span>}
      </div>
      {recorridoDebajo(v) && <div className="viaje-ruta">{recorridoDebajo(v)}</div>}
      <div className="viaje-abajo">
        <span>
          <strong className="viaje-hora-chica">
            {v.tipo === 'programado' ? hora(v.hora_presentacion) : hora(v.hora_asignacion)}
          </strong>
          {mostrarFecha && ` ${fechaCorta(v.hora_asignacion)}`}
          {/* Sin "Inmediato" / "Programado" (24/10/2026: menos cosas escritas). */}
          {v.viaje_fijo_id && ' · 🔁'} · #{v.id}
        </span>
        <span>
          {v.chofer ? (fijo ? '📌 ' : '') + v.chofer.nombre
            : esperaFijo ? `📌 ${v.fijo?.nombre ?? ''} (se le ofrece el ${fechaCorta(cuandoSeOfrece(v))})`
            : v.espera_gestion && v.rechazo ? `❌ Lo rechazó ${v.rechazo.nombre}`
            : urgente ? '⚠️ Falta chofer' : ''}
        </span>
      </div>
      {v.estado === 'finalizado' && (
        <div className="viaje-abajo">
          <span />
          <span className="importe">
            {dinero(totalCobrado(v))} · {(v.cuenta?.nombre || v.cuenta_otro)
              ? `Cta. cte. ${v.cuenta?.nombre ?? v.cuenta_otro}` : FORMAS_PAGO[v.forma_pago]}
          </span>
        </div>
      )}
    </button>
  )
  if (!conTick) return tarjeta

  // El tick va afuera del botón de la tarjeta (tocarlo no abre el viaje).
  return (
    <div className="tarjeta-con-tick">
      {tarjeta}
      <button type="button" className={'tick-aprobar' + (elegido ? ' elegido' : '')} onClick={onTickear}
        aria-label={elegido ? 'Destickear' : 'Tickear para aprobar el pago'} aria-pressed={!!elegido}>✓</button>
    </div>
  )
}
