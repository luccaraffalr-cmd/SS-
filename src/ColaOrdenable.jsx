import { useEffect, useState } from 'react'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Cola "tipo Spotify": se arrastra cada chofer por la manija ≡ al puesto que se quiera.
// onMover(chofer, puestoNuevo) guarda el cambio; onSacar(chofer) lo saca de la cola.
export default function ColaOrdenable({ cola, onMover, onSacar }) {
  // Copia local para que el chofer quede en su lugar nuevo apenas se suelta.
  const [orden, setOrden] = useState(cola)
  useEffect(() => { setOrden(cola) }, [cola])

  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function alSoltar({ active, over }) {
    if (!over || active.id === over.id) return
    const desde = orden.findIndex((c) => c.id === active.id)
    const hasta = orden.findIndex((c) => c.id === over.id)
    setOrden(arrayMove(orden, desde, hasta))
    onMover(active.id, hasta + 1)
  }

  return (
    <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={alSoltar}>
      <SortableContext items={orden.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ol className="cola-ordenable">
          {orden.map((c, i) => (
            <FilaCola key={c.id} chofer={c} puesto={i + 1} onSacar={onSacar} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

function FilaCola({ chofer, puesto, onSacar }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chofer.id })

  return (
    <li
      ref={setNodeRef}
      className={'fila-cola' + (isDragging ? ' arrastrando' : '')}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span className="numero">{puesto}</span>
      <span className="nombre">{chofer.perfiles.nombre}</span>
      <button className="boton-chico" onClick={() => onSacar(chofer.id)}>Sacar</button>
      <button className="manija" aria-label={'Mover a ' + chofer.perfiles.nombre} {...attributes} {...listeners}>≡</button>
    </li>
  )
}
