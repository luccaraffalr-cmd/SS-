import { useState } from 'react'

// "No ofrecer a" (pedido del dueño, 26/10/2026): choferes a los que nunca se les ofrece este viaje (el cliente no quiere
// que lo lleven, hace falta un auto con baúl…). choferes: [{ id, nombre }]; excluidos: ids; onCambiar(ids). Se despliega
// para no ocupar lugar.
export default function ElegirExcluidos({ choferes, excluidos, onCambiar }) {
  const [abierto, setAbierto] = useState(false)
  const nombres = choferes.filter((c) => excluidos.includes(c.id)).map((c) => c.nombre)
  const alternar = (id) => onCambiar(excluidos.includes(id) ? excluidos.filter((x) => x !== id) : [...excluidos, id])

  return (
    <div className="campo-excluidos">
      <button type="button" className="boton-desplegar" onClick={() => setAbierto(!abierto)}>
        <span>🚫 No ofrecer a: <strong>{nombres.length ? nombres.join(', ') : 'nadie (todos pueden)'}</strong></span>
        <span>{abierto ? '▲' : '▼'}</span>
      </button>
      {abierto && (
        <>
          <div className="chips-choferes">
            {choferes.map((c) => (
              <button key={c.id} type="button" className={'chip-chofer' + (excluidos.includes(c.id) ? ' excluido' : '')}
                onClick={() => alternar(c.id)}>
                {excluidos.includes(c.id) ? '🚫 ' : ''}{c.nombre}
              </button>
            ))}
          </div>
          <small className="ayuda sin-margen">
            Tocá los choferes a los que no se les ofrece (por ejemplo, si el viaje necesita un auto con baúl). Se le ofrece al
            primero de la cola de los demás; a estos, nunca. Si ninguno de los demás lo toma, a gestión le suena el aviso y lo
            asigna a mano.
          </small>
        </>
      )}
    </div>
  )
}
