import { useEffect, useState } from 'react'

const dos = (n) => String(n).padStart(2, '0')

// Lo escrito → "HH:MM", o null si no es una hora. Sirve con y sin dos puntos: "1430", "930", "9", "14:5", "14.30".
export function leerHora(texto) {
  const t = String(texto ?? '').trim().replace(/[.,h ]/g, ':')
  if (!t) return null
  let h, m
  if (t.includes(':')) {
    [h, m] = t.split(':')
  } else {
    const digitos = t.replace(/\D/g, '')
    if (!digitos || digitos.length > 4) return null
    h = digitos.length <= 2 ? digitos : digitos.slice(0, -2)
    m = digitos.length <= 2 ? '0' : digitos.slice(-2)
  }
  if (!/^\d{1,2}$/.test(h) || !/^\d{0,2}$/.test(m ?? '')) return null
  const hh = Number(h), mm = Number(m || 0)
  return hh <= 23 && mm <= 59 ? `${dos(hh)}:${dos(mm)}` : null
}

// Hora siempre en 24 hs, escrita con el teclado de números: "1430" queda "14:30" (pedido del dueño, 24/10/2026: el campo
// de hora del celular mostraba a. m./p. m. y las listas eran incómodas). valor: "HH:MM" o '' (sin hora válida).
export default function ElegirHora({ valor, onCambiar }) {
  const [texto, setTexto] = useState(valor ?? '')
  // Si el valor cambia desde afuera (otro viaje), se muestra ese.
  useEffect(() => { if (leerHora(texto) !== (valor || null)) setTexto(valor ?? '') }, [valor]) // eslint-disable-line react-hooks/exhaustive-deps

  const valida = leerHora(texto)
  return (
    <span className="elegir-hora">
      <input inputMode="numeric" placeholder="ej: 1430" value={texto} aria-label="Hora (24 hs)"
        className={texto && !valida ? 'hora-mal' : ''}
        onChange={(e) => { setTexto(e.target.value); onCambiar(leerHora(e.target.value) ?? '') }}
        onBlur={() => { if (valida) setTexto(valida) }} />
      {texto && !valida && <small className="texto-alerta">Hora no válida (de 00:00 a 23:59)</small>}
    </span>
  )
}
