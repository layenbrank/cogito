import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates
} from '@dnd-kit/sortable'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { clsx } from 'clsx'
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { CHANNELS } from '@/shared/ipc/channels'
import {
  useSignboardStore,
  type SignboardEntry,
  type SignboardColumn,
  type SignboardTag
} from '@/stores/signboard'
import { ColumnLane } from '@/views/signboard/column-lane'
import {
  CardDragPreview,
  ColumnDragPreview,
  type OverlaySize
} from '@/views/signboard/drag-preview'
import {
  createKanbanCollision,
  moveEntryDraft,
  parseColumnDropID,
  resolveCardDrop,
  type DragKind,
  type DroppableData
} from '@/views/signboard/dnd'
import styles from '@/views/signboard/signboard.module.scss'
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

function parseSemantic(column: { title: string; index: number; role: string | null }) {
  if (column.role === 'todo' || column.role === 'doing' || column.role === 'done') {
    return column.role
  }
  const title = column.title
  if (title.includes('完成') || title.toLowerCase().includes('done')) return 'done' as const
  if (title.includes('进行') || title.toLowerCase().includes('doing')) return 'doing' as const
  if (column.index === 0 || title.includes('待办')) return 'todo' as const
  return 'other' as const
}

function findEntriesInColumn(entries: SignboardEntry[], columnID: string) {
  return entries
    .filter(function (card) {
      return card.columnID === columnID && card.archivedAt === null
    })
    .slice()
    .sort(function (a, b) {
      return a.index - b.index
    })
}

function findCardColumnID(entries: SignboardEntry[], cardID: string) {
  const card = entries.find(function (row) {
    return row.id === cardID
  })
  return card?.columnID ?? null
}

function KanbanView(props: KanbanViewProps) {
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
  /** 仅跨列拖卡时使用；同列靠 sortable transform，避免 onDragOver 改序闪烁 */
  const [liveEntries, setLiveEntries] = useState<SignboardEntry[] | null>(null)
  const [originCardSlot, setOriginCardSlot] = useState<{
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
      return createKanbanCollision(dragKind)
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
      async function loadCovers() {
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
          console.warn('loadCovers failed', error)
          if (!cancelled) setCoverSrcByCard(new Map())
        }
      }
      void loadCovers()
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
    setOriginCardSlot(null)
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
      setOriginCardSlot(null)
      return
    }

    const cardID = String(event.active.id)
    const card = props.entries.find(function (row) {
      return row.id === cardID
    })
    setActiveDragID(cardID)
    // 同列不预建 liveEntries，避免整板重渲染打断 sortable transform 过渡
    setLiveEntries(null)
    setOriginCardSlot(
      card ? { columnID: card.columnID, index: card.index } : null
    )
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

    // 同列：完全不碰 React 状态，只靠 useSortable 的 transform/transition
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
    const startCardSlot = originCardSlot
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

    // 跨列：dragOver 已写入 liveEntries，直接按最终槽位落库
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
    } else if (overData?.type === 'card' || cards.some(function (card) {
      return card.id === String(over.id)
    })) {
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={{
        droppable: { strategy: MeasuringStrategy.Always }
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}>
      <div
        className={clsx(
          styles.board,
          dragKind === 'card' && styles.boardDraggingCard,
          dragKind === 'column-sort' && styles.boardDraggingColumn
        )}>
        {props.columns.length === 0 ? (
          <div className={styles.emptyBoard}>
            <div className={styles.emptyIcon}>
              <Icon
                icon="lucide:kanban"
                className="size-6"
              />
            </div>
            <p className={styles.emptyTitle}>还没有列</p>
            <p className={styles.emptyDesc}>
              先建一列工作流状态，再把事情放进去。默认可用「待办 / 进行中 / 完成」。
            </p>
            <Button
              type="button"
              size="lg"
              className="mt-1 px-4"
              onClick={function () {
                props.onAddingColumnChange(true)
              }}>
              添加第一列
            </Button>
          </div>
        ) : (
          <SortableContext
            items={columnIDs}
            strategy={horizontalListSortingStrategy}>
            {props.columns.map(function (column, columnIndex) {
              return (
                <ColumnLane
                  key={column.id}
                  column={column}
                  columnIndex={columnIndex}
                  canMoveLeft={columnIndex > 0}
                  canMoveRight={columnIndex < props.columns.length - 1}
                  onMoveColumn={moveColumnByMenu}
                  entries={entriesInColumn(column.id)}
                  tagsByCard={props.tagsByCard}
                  checksForEntry={checksForEntry}
                  coverSrcByCard={coverSrcByCard}
                  attachmentCountByCard={attachmentCountByCard}
                  dragKind={dragKind}
                  isDimmedCard={props.isDimmedCard}
                  selectedCardID={props.selectedCardID}
                  semantic={parseSemantic(column)}
                  requestAdd={props.addRequestColumnID === column.id}
                  onConsumedAddRequest={props.onConsumedAddRequest}
                  onOpenCard={props.onOpenCard}
                  onFocusCard={props.onFocusCard}
                  onKeyMove={onKeyMove}
                  onWriteCard={async function (columnID, title) {
                    const id = await toWriteEntry({ columnID, title })
                    if (!id) {
                      toast.error('添加卡片失败')
                      return
                    }
                    toast.success('已添加卡片')
                  }}
                  onRenameColumn={props.onRenameColumn}
                  onArchiveColumn={props.onArchiveColumn}
                  onArchiveCard={props.onArchiveCard}
                />
              )
            })}
          </SortableContext>
        )}

        {props.addingColumn || props.columns.length > 0 ? (
          <div className={styles.addColumn}>
            {props.addingColumn ? (
              <>
                <Input
                  autoFocus
                  value={props.columnDraft}
                  placeholder="列名称，例如：评审中"
                  className="h-9"
                  onChange={function (event) {
                    props.onColumnDraftChange(event.target.value)
                  }}
                  onKeyDown={function (event) {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void props.onCommitColumn()
                    }
                    if (event.key === 'Escape') {
                      props.onAddingColumnChange(false)
                      props.onColumnDraftChange('')
                    }
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="lg"
                    className="flex-1"
                    onClick={function () {
                      void props.onCommitColumn()
                    }}>
                    添加
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    variant="ghost"
                    onClick={function () {
                      props.onAddingColumnChange(false)
                      props.onColumnDraftChange('')
                    }}>
                    取消
                  </Button>
                </div>
              </>
            ) : (
              <Button
                type="button"
                size="lg"
                variant="outline"
                className={styles.addCard}
                onClick={function () {
                  props.onAddingColumnChange(true)
                }}>
                <Icon
                  icon="lucide:plus"
                  className="size-4"
                />
                添加列
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <DragOverlay
        dropAnimation={null}
        adjustScale={false}>
        {dragCard ? (
          <CardDragPreview
            card={dragCard}
            tags={props.tagsByCard.get(dragCard.id) ?? []}
            checklist={checksForEntry(dragCard.id)}
            coverSrc={coverSrcByCard.get(dragCard.id) ?? null}
            attachmentCount={attachmentCountByCard.get(dragCard.id) ?? 0}
            size={overlaySize}
          />
        ) : null}
        {dragColumn ? (
          <ColumnDragPreview
            column={dragColumn}
            semantic={parseSemantic(dragColumn)}
            entries={entriesInColumn(dragColumn.id)}
            tagsByCard={props.tagsByCard}
            checksForEntry={checksForEntry}
            coverSrcByCard={coverSrcByCard}
            attachmentCountByCard={attachmentCountByCard}
            size={overlaySize}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

export { KanbanView }
