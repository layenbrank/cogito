import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { CHANNELS } from '@/shared/ipc/channels'
import {
  useSignboardStore,
  type SignboardColumn,
  type SignboardEntry,
  type SignboardTag
} from '@/stores/signboard'
import {
  buildKanbanCollision,
  moveEntryDraft,
  parseColumnDropID,
  resolveCardDrop,
  type DragKind,
  type DroppableData
} from '@/views/signboard/dnd'
import type { OverlaySize } from '@/views/signboard/drag-preview'
import {
  findCardColumnID,
  findEntriesInColumn,
  parseSemantic
} from '@/views/signboard/kanban-helpers'
import type { GalleryAsset } from '@/views/gallery/model/media'

interface KanbanViewProps {
  columns: SignboardColumn[]
  entries: SignboardEntry[]
  tagsByCard: Map<string, SignboardTag[]>
  isDimmedCard: (entryID: string) => boolean
  selectedCardID: string | null
  addRequestColumnID: string | null
  addingColumn: boolean
  columnDraft: string
  onColumnDraftChange: (value: string) => void
  onAddingColumnChange: (value: boolean) => void
  onConsumedAddRequest: () => void
  onOpenCard: (entryID: string) => void
  onFocusCard: (entryID: string) => void
  onRenameColumn: (column: SignboardColumn) => void
  onArchiveColumn: (columnID: string) => void
  onArchiveCard: (entryID: string) => void
  onCommitColumn: () => Promise<void>
}

function useKanbanBoard(props: KanbanViewProps) {
  const storeEntriesInColumn = useSignboardStore(function (state) {
    return state.entriesInColumn
  })
  const toMoveEntry = useSignboardStore(function (state) {
    return state.toMoveEntry
  })
  const toMoveColumn = useSignboardStore(function (state) {
    return state.toMoveColumn
  })
  const toWriteEntry = useSignboardStore(function (state) {
    return state.toWriteEntry
  })
  const checksForEntry = useSignboardStore(function (state) {
    return state.checksForEntry
  })
  const coverAssetID = useSignboardStore(function (state) {
    return state.coverAssetID
  })
  const entryAssets = useSignboardStore(function (state) {
    return state.entryAssets
  })

  const [dragKind, setDragKind] = useState<DragKind | null>(null)
  const [activeDragID, setActiveDragID] = useState<string | null>(null)
  const [overlaySize, setOverlaySize] = useState<OverlaySize | null>(null)
  const [liveEntries, setLiveEntries] = useState<SignboardEntry[] | null>(null)
  const originCardSlotRef = useRef<{
    columnID: string
    index: number
  } | null>(null)
  const [coverSrcByCard, setCoverSrcByCard] = useState<Map<string, string>>(
    function () {
      return new Map()
    }
  )

  const boardEntries = liveEntries ?? props.entries

  const collisionDetection = useMemo(
    function () {
      return buildKanbanCollision(dragKind)
    },
    [dragKind]
  )

  const attachmentCountByCard = useMemo(
    function () {
      const map = new Map<string, number>()
      for (const row of entryAssets) {
        map.set(row.entryID, (map.get(row.entryID) ?? 0) + 1)
      }
      return map
    },
    [entryAssets]
  )

  const coverKey = useMemo(
    function () {
      return props.entries
        .map(function (card) {
          return `${card.id}:${coverAssetID(card.id) ?? ''}`
        })
        .join('|')
    },
    [props.entries, coverAssetID]
  )

  useEffect(
    function () {
      let cancelled = false
      async function fetchCovers() {
        const pairs: { entryID: string; assetID: string }[] = []
        for (const card of props.entries) {
          const assetID = coverAssetID(card.id)
          if (assetID) pairs.push({ entryID: card.id, assetID })
        }
        if (pairs.length === 0) {
          setCoverSrcByCard(new Map())
          return
        }
        try {
          const assets = await invoke<GalleryAsset[]>(CHANNELS.ASSET.READ, {
            params: pairs.map(function (row) {
              return { id: row.assetID }
            })
          })
          const byID = new Map(
            assets.map(function (asset) {
              return [asset.id, asset]
            })
          )
          if (cancelled) return
          const next = new Map<string, string>()
          for (const pair of pairs) {
            const asset = byID.get(pair.assetID)
            if (asset) next.set(pair.entryID, convertFileSrc(asset.filePath))
          }
          setCoverSrcByCard(next)
        } catch (error) {
          console.warn('fetchCovers failed', error)
          if (!cancelled) setCoverSrcByCard(new Map())
        }
      }
      void fetchCovers()
      return function () {
        cancelled = true
      }
    },
    [coverKey, props.entries, coverAssetID]
  )

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 10 }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  function entriesInColumn(columnID: string) {
    if (liveEntries) return findEntriesInColumn(liveEntries, columnID)
    return storeEntriesInColumn(columnID)
  }

  function clearDragState() {
    setDragKind(null)
    setActiveDragID(null)
    setOverlaySize(null)
    setLiveEntries(null)
    originCardSlotRef.current = null
  }

  function onDragStart(event: DragStartEvent) {
    const activeData = event.active.data.current as DroppableData | undefined
    const kind = activeData?.type === 'column-sort' ? 'column-sort' : 'card'
    const initial = event.active.rect.current.initial
    setDragKind(kind)
    setOverlaySize(
      initial
        ? { width: Math.round(initial.width), height: Math.round(initial.height) }
        : null
    )

    if (kind === 'column-sort') {
      const columnID = activeData?.columnID ?? String(event.active.id)
      setActiveDragID(columnID)
      setLiveEntries(null)
      originCardSlotRef.current = null
      return
    }

    const cardID = String(event.active.id)
    const card = props.entries.find(function (row) {
      return row.id === cardID
    })
    setActiveDragID(cardID)
    setLiveEntries(null)
    originCardSlotRef.current = card
      ? { columnID: card.columnID, index: card.index }
      : null
  }

  function onDragOver(event: DragOverEvent) {
    const activeData = event.active.data.current as DroppableData | undefined
    if (activeData?.type === 'column-sort') return
    if (activeData?.type !== 'card') return

    const over = event.over
    if (!over) return

    const overData = over.data.current as DroppableData | undefined
    const activeID = String(event.active.id)
    const overColumnID =
      overData?.columnID ?? parseColumnDropID(String(over.id)) ?? null
    if (!overColumnID) return

    const sourceEntries = liveEntries ?? props.entries
    const fromColumnID = findCardColumnID(sourceEntries, activeID)
    if (!fromColumnID) return

    if (fromColumnID === overColumnID) return

    const translated = event.active.rect.current.translated
    const target = resolveCardDrop({
      activeID,
      overID: String(over.id),
      overType: overData?.type,
      overColumnID,
      pointerY: translated
        ? translated.top + translated.height / 2
        : null,
      overRect: over.rect
        ? { top: over.rect.top, height: over.rect.height }
        : null,
      entriesInColumn: function (columnID) {
        return findEntriesInColumn(sourceEntries, columnID)
      }
    })
    if (!target || target.toColumnID === fromColumnID) return

    const moving = sourceEntries.find(function (card) {
      return card.id === activeID
    })
    if (
      moving &&
      moving.columnID === target.toColumnID &&
      moving.index === target.toIndex
    ) {
      return
    }

    setLiveEntries(
      moveEntryDraft(
        sourceEntries.map(function (row) {
          return { ...row }
        }),
        target.activeID,
        target.toColumnID,
        target.toIndex
      )
    )
  }

  function onDragEnd(event: DragEndEvent) {
    const kind = dragKind
    const finalEntries = liveEntries
    const startCardSlot = originCardSlotRef.current
    const { active, over } = event
    clearDragState()

    if (!over) return

    const activeData = active.data.current as DroppableData | undefined
    const overData = over.data.current as DroppableData | undefined

    if (kind === 'column-sort' || activeData?.type === 'column-sort') {
      const activeColumnID = activeData?.columnID ?? String(active.id)
      const overColumnID = overData?.columnID ?? String(over.id)
      const fromIndex = props.columns.findIndex(function (column) {
        return column.id === activeColumnID
      })
      const toIndex = props.columns.findIndex(function (column) {
        return column.id === overColumnID
      })
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
      void toMoveColumn(activeColumnID, toIndex).then(function (ok) {
        if (!ok) toast.error('列顺序保存失败，已恢复')
      })
      return
    }

    const activeID = String(active.id)
    const entries = finalEntries ?? props.entries
    const liveCard = finalEntries?.find(function (card) {
      return card.id === activeID
    })

    if (
      liveCard &&
      startCardSlot &&
      liveCard.columnID !== startCardSlot.columnID
    ) {
      void toMoveEntry(activeID, liveCard.columnID, liveCard.index).then(
        function (ok) {
          if (!ok) toast.error('没能保存顺序，已恢复')
        }
      )
      return
    }

    const fromColumnID =
      startCardSlot?.columnID ?? findCardColumnID(entries, activeID)
    if (!fromColumnID) return

    const cards = findEntriesInColumn(entries, fromColumnID)
    const fromIndex = cards.findIndex(function (card) {
      return card.id === activeID
    })
    if (fromIndex < 0) return

    const overIsColumnDrop =
      overData?.type === 'column-drop' ||
      parseColumnDropID(String(over.id)) !== null

    let toIndex = -1
    if (overIsColumnDrop) {
      toIndex = cards.length - 1
    } else if (
      overData?.type === 'card' ||
      cards.some(function (card) {
        return card.id === String(over.id)
      })
    ) {
      toIndex = cards.findIndex(function (card) {
        return card.id === String(over.id)
      })
    }

    if (toIndex < 0 || fromIndex === toIndex) return

    void toMoveEntry(activeID, fromColumnID, toIndex).then(function (ok) {
      if (!ok) toast.error('没能保存顺序，已恢复')
    })
  }

  function moveColumnByMenu(columnID: string, toIndex: number) {
    void toMoveColumn(columnID, toIndex).then(function (ok) {
      if (!ok) toast.error('列顺序保存失败，已恢复')
    })
  }

  function onDragCancel() {
    clearDragState()
  }

  function onKeyMove(entryID: string, event: KeyboardEvent) {
    const meta = event.metaKey || event.ctrlKey
    if (!meta) {
      if (event.key === 'Enter') {
        event.preventDefault()
        props.onOpenCard(entryID)
      }
      return
    }

    const card = props.entries.find(function (row) {
      return row.id === entryID
    })
    if (!card) return
    const colIndex = props.columns.findIndex(function (column) {
      return column.id === card.columnID
    })
    if (colIndex < 0) return
    const columnCards = storeEntriesInColumn(card.columnID)
    const index = columnCards.findIndex(function (row) {
      return row.id === entryID
    })

    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault()
      void toMoveEntry(entryID, card.columnID, index - 1)
    }
    if (event.key === 'ArrowDown' && index < columnCards.length - 1) {
      event.preventDefault()
      void toMoveEntry(entryID, card.columnID, index + 1)
    }
    if (event.key === 'ArrowLeft' && colIndex > 0) {
      event.preventDefault()
      const dest = props.columns[colIndex - 1]
      if (!dest) return
      void toMoveEntry(entryID, dest.id, storeEntriesInColumn(dest.id).length)
    }
    if (event.key === 'ArrowRight' && colIndex < props.columns.length - 1) {
      event.preventDefault()
      const dest = props.columns[colIndex + 1]
      if (!dest) return
      void toMoveEntry(entryID, dest.id, storeEntriesInColumn(dest.id).length)
    }
  }

  const columnIDs = props.columns.map(function (column) {
    return column.id
  })

  const dragCard =
    dragKind === 'card'
      ? boardEntries.find(function (card) {
          return card.id === activeDragID
        })
      : undefined
  const dragColumn =
    dragKind === 'column-sort'
      ? props.columns.find(function (column) {
          return column.id === activeDragID
        })
      : undefined

  async function onWriteCard(columnID: string, title: string) {
    const id = await toWriteEntry({ columnID, title })
    if (!id) {
      toast.error('添加卡片失败')
      return
    }
    toast.success('已添加卡片')
  }

  return {
    viewProps: props,
    sensors,
    collisionDetection,
    dragKind,
    overlaySize,
    coverSrcByCard,
    attachmentCountByCard,
    checksForEntry,
    entriesInColumn,
    columnIDs,
    dragCard,
    dragColumn,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
    onKeyMove,
    moveColumnByMenu,
    onWriteCard,
    parseSemantic
  }
}

export { useKanbanBoard }
export type { KanbanViewProps }
