const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTOS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

// Hora siempre en formato 24 hs ("14:30"), con dos listas: hora y minutos. El campo de hora del celular o de la compu
// a veces muestra a. m. / p. m. (pedido del 22/10/2026). valor: "HH:MM" o '' (sin elegir).
export default function ElegirHora({ valor, onCambiar }) {
  const [h, m] = valor ? valor.split(':') : ['', '']
  return (
    <span className="elegir-hora">
      <select aria-label="Hora" value={h} onChange={(e) => onCambiar(e.target.value ? `${e.target.value}:${m || '00'}` : '')}>
        <option value="">--</option>
        {HORAS.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <strong>:</strong>
      <select aria-label="Minutos" value={m || '00'} disabled={!h} onChange={(e) => onCambiar(`${h}:${e.target.value}`)}>
        {MINUTOS.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </span>
  )
}
