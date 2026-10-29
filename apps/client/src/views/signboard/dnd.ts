import {
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DroppableContainer
} from '@dnd-kit/core'

type DragKind = 'card' | 'column-sort'

interface DroppableData {
  type?: string
  columnID?: string
}

interface CardDropTarget {
  activeID: string
  toColumnID: string
  toIndex: number
}

function readData(container: DroppableContainer | undefined): DroppableData | undefined {
  return container?.data.current
}

function filterByType(
  containers: DroppableContainer[],
  types: string[]
): DroppableContainer[] {
  return containers.filter(function (container) {
    const type = readData(container)?.type
    return type !== undefined && types.includes(type)
  })
}

function columnDropID(columnID: string) {
  return `column-drop:${columnID}`
}

function parseColumnDropID(id: string): string | null {
  if (!id.startsWith('column-drop:')) return null
  return id.slice('column-drop:'.length)
}

function moveByIndex<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return items
  if (fromIndex < 0 || toIndex < 0) return items
  if (fromIndex >= items.length || toIndex >= items.length) return items
  const next = items.slice()
  const [row] = next.splice(fromIndex, 1)
  if (row === undefined) return items
  next.splice(toIndex, 0, row)
  return next
}

/** 拖拽过程中乐观重排 entry（不写库），逻辑对齐 store.toMoveEntry */
function moveEntryDraft<T extends { id: string; columnID: string; index: number }>(
  entries: T[],
  activeID: string,
  toColumnID: string,
  toIndex: number
): T[] {
  const moving = entries.find(function (card) {
    return card.id === activeID
  })
  if (!moving) return entries
  if (moving.columnID === toColumnID && moving.index === toIndex) {
    return entries
  }

  const fromColumnID = moving.columnID
  const others = entries.filter(function (card) {
    return card.id !== activeID
  })
  const dest = others
    .filter(function (card) {
      return card.columnID === toColumnID
    })
    .sort(function (a, b) {
      return a.index - b.index
    })
  const clamped = Math.max(0, Math.min(toIndex, dest.length))
  dest.splice(clamped, 0, { ...moving, columnID: toColumnID })

  const reindexed = new Map<string, T>()
  dest.forEach(function (card, index) {
    reindexed.set(card.id, { ...card, columnID: toColumnID, index })
  })

  if (fromColumnID !== toColumnID) {
    others
      .filter(function (card) {
        return card.columnID === fromColumnID
      })
      .sort(function (a, b) {
        return a.index - b.index
      })
      .forEach(function (card, index) {
        reindexed.set(card.id, { ...card, index })
      })
  }

  return entries.map(function (card) {
    return reindexed.get(card.id) ?? card
  })
}

/**
 * 列拖：只撞列。
 * 卡拖：优先撞卡片（sortable 靠 over 卡片实时变化驱动 transform 过渡）；
 * 仅在空白列区才落到 column-drop。不粘滞 lastOver，避免同列过渡卡住。
 */
function buildKanbanCollision(dragKind: DragKind | null): CollisionDetection {
  return function (detection) {
    const activeType = (detection.active.data.current as DroppableData | undefined)?.type
    const kind = dragKind ?? (activeType === 'column-sort' ? 'column-sort' : 'card')

    if (kind === 'column-sort') {
      const columns = filterByType(detection.droppableContainers, ['column-sort'])
      if (columns.length === 0) return []
      return closestCenter({ ...detection, droppableContainers: columns })
    }

    const cards = filterByType(detection.droppableContainers, ['card'])
    const columnDrops = filterByType(detection.droppableContainers, ['column-drop'])

    if (cards.length > 0) {
      const pointerOnCards = pointerWithin({
        ...detection,
        droppableContainers: cards
      })
      if (pointerOnCards.length > 0) {
        return pointerOnCards
      }

      const rectOnCards = rectIntersection({
        ...detection,
        droppableContainers: cards
      })
      if (rectOnCards.length > 0) {
        return closestCenter({
          ...detection,
          droppableContainers: cards
        })
      }

      // 指针在列空白处：先定列，再取该列内最近卡片，保证 sortable 仍有 over 卡片
      if (columnDrops.length > 0) {
        const pointerOnColumns = pointerWithin({
          ...detection,
          droppableContainers: columnDrops
        })
        const columnOverID =
          pointerOnColumns[0]?.id ??
          getFirstCollision(
            rectIntersection({
              ...detection,
              droppableContainers: columnDrops
            }),
            'id'
          )
        const parsedColumnID =
          columnOverID !== undefined && columnOverID !== null
            ? parseColumnDropID(String(columnOverID))
            : null

        if (parsedColumnID && columnOverID !== undefined && columnOverID !== null) {
          const cardsInColumn = cards.filter(function (container) {
            return readData(container)?.columnID === parsedColumnID
          })
          if (cardsInColumn.length > 0) {
            return closestCenter({
              ...detection,
              droppableContainers: cardsInColumn
            })
          }
          return [{ id: columnOverID }]
        }
      }

      return closestCenter({
        ...detection,
        droppableContainers: cards
      })
    }

    if (columnDrops.length === 0) return []
    const pointerOnColumns = pointerWithin({
      ...detection,
      droppableContainers: columnDrops
    })
    if (pointerOnColumns.length > 0) return pointerOnColumns
    return closestCenter({
      ...detection,
      droppableContainers: columnDrops
    })
  }
}

/**
 * 跨列落点解析。同列换位不走这里，由 sortable indexOf(over) 决定。
 */
function resolveCardDrop(args: {
  activeID: string
  overID: string
  overType: string | undefined
  overColumnID: string | undefined
  pointerY: number | null
  overRect: { top: number; height: number } | null
  entriesInColumn: (columnID: string) => { id: string }[]
}): CardDropTarget | null {
  const toColumnID = args.overColumnID ?? parseColumnDropID(args.overID) ?? undefined
  if (!toColumnID) return null

  const destCards = args.entriesInColumn(toColumnID).filter(function (card) {
    return card.id !== args.activeID
  })

  if (args.overType === 'column-drop' || parseColumnDropID(args.overID)) {
    return {
      activeID: args.activeID,
      toColumnID,
      toIndex: destCards.length
    }
  }

  if (args.overID === args.activeID) return null

  const overCardIndex = destCards.findIndex(function (card) {
    return card.id === args.overID
  })
  if (overCardIndex < 0) {
    return {
      activeID: args.activeID,
      toColumnID,
      toIndex: destCards.length
    }
  }

  let insertAfter = false
  if (args.pointerY !== null && args.overRect) {
    const overMid = args.overRect.top + args.overRect.height / 2
    insertAfter = args.pointerY > overMid
  }

  return {
    activeID: args.activeID,
    toColumnID,
    toIndex: insertAfter ? overCardIndex + 1 : overCardIndex
  }
}

export {
  columnDropID,
  buildKanbanCollision,
  moveByIndex,
  moveEntryDraft,
  parseColumnDropID,
  resolveCardDrop
}
export type { CardDropTarget, DragKind, DroppableData }
