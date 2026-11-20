import { createContext, useContext, type DragEvent } from 'react'

interface TileDrag {
  overID: string | null
  over: (id: string | null) => void
  drop: (targetID: string, sourceID: string) => void
}

export const TileDragContext = createContext<TileDrag | null>(null)

export function useTileDrag(id: string) {
  const drag = useContext(TileDragContext)
  const isOver = drag?.overID === id

  function onDragStart(event: DragEvent<HTMLDivElement>): void {
    event.dataTransfer.setData('text/plain', id)
    event.dataTransfer.effectAllowed = 'move'
    drag?.over(id)
  }

  function onDragOver(event: DragEvent<HTMLDivElement>): void {
    if (!drag) return
    event.preventDefault()
    drag.over(id)
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    if (!drag) return
    event.preventDefault()
    drag.drop(id, event.dataTransfer.getData('text/plain'))
  }

  return {
    isOver,
    dragProps: drag
      ? {
          draggable: true,
          onDragStart,
          onDragOver,
          onDrop
        }
      : {}
  }
}

export type { TileDrag }
