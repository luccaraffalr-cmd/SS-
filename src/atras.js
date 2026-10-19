import { useEffect, useRef } from 'react'

// Botón "atrás" del celular o del navegador (pedido del 19/10/2026): hace lo mismo que los botones "Volver".
// Cada cosa que se abre "encima" (un viaje, viajes fijos, la ficha de un usuario, cargar el pago…) agrega un paso al
// historial del navegador; el botón atrás saca ese paso y la cierra. Si se cierra desde la app (Volver, Guardar…),
// se saca su paso para que el historial quede igual. En la app Android, MainActivity le pasa el botón atrás a la página.

const abiertas = [] // la última es la de arriba
let pasosPorSacar = 0
let ignorarProximo = 0

// Saca del historial los pasos de lo que se cerró desde la app (si se cierran varias juntas, en un solo movimiento).
function sacarPaso() {
  pasosPorSacar++
  if (pasosPorSacar > 1) return
  queueMicrotask(() => {
    const n = pasosPorSacar
    pasosPorSacar = 0
    ignorarProximo++
    window.history.go(-n)
  })
}

window.addEventListener('popstate', (e) => {
  if (ignorarProximo > 0) { ignorarProximo--; return }
  const arriba = abiertas.pop()
  if (arriba) arriba.cerrar()
  // Pasos que quedaron de antes de recargar la página: se saltean hasta llegar al principio.
  else if (e.state?.capa) window.history.back()
})

// Mientras `abierta` sea verdadero, el botón atrás llama a `cerrar` (lo mismo que hace su botón "Volver").
export function useAtras(abierta, cerrar) {
  const cerrarActual = useRef(cerrar)
  useEffect(() => { cerrarActual.current = cerrar })
  useEffect(() => {
    if (!abierta) return
    const capa = { cerrar: () => cerrarActual.current() }
    abiertas.push(capa)
    window.history.pushState({ capa: true }, '')
    return () => {
      const i = abiertas.indexOf(capa)
      if (i !== -1) {
        abiertas.splice(i, 1)
        sacarPaso()
      }
    }
  }, [abierta])
}
