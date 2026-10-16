import { useState } from 'react'
import { DIAS_GRILLA, MESES, deFechaLocal, diasDeLaGrilla, fechaLocal } from './viajes.js'

// Calendario chico para elegir varios días sueltos (tocar un día lo marca o lo desmarca). Los días que ya pasaron no se
// pueden elegir. fechas: ["2026-10-15", …]
export default function ElegirFechas({ fechas, onCambiar }) {
  const [mes, setMes] = useState(() => {
    const d = fechas.length ? deFechaLocal(fechas.slice().sort()[0]) : new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const hoy = fechaLocal()
  const cambiarMes = (cuanto) => setMes(new Date(mes.getFullYear(), mes.getMonth() + cuanto, 1))

  function alternar(clave) {
    onCambiar(fechas.includes(clave) ? fechas.filter((f) => f !== clave) : [...fechas, clave].sort())
  }

  return (
    <div className="elegir-fechas">
      <div className="calendario-arriba">
        <button type="button" className="boton-chico gris" onClick={() => cambiarMes(-1)} aria-label="Mes anterior">◀</button>
        <strong>{MESES[mes.getMonth()]} {mes.getFullYear()}</strong>
        <button type="button" className="boton-chico gris" onClick={() => cambiarMes(1)} aria-label="Mes siguiente">▶</button>
      </div>
      <div className="calendario">
        {DIAS_GRILLA.map((d) => <span key={d} className="calendario-dia-semana">{d}</span>)}
        {diasDeLaGrilla(mes).map((d) => {
          const clave = fechaLocal(d)
          const paso = clave < hoy
          return (
            <button key={clave} type="button" disabled={paso}
              className={'dia-chico' + (d.getMonth() !== mes.getMonth() ? ' otro-mes' : '') + (clave === hoy ? ' hoy' : '')
                + (fechas.includes(clave) ? ' marcado' : '')}
              onClick={() => alternar(clave)}>
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
