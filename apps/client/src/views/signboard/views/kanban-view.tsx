import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import {
  useSignboardStore,
  type SignboardEntry,
  type SignboardColumn,
  type SignboardTag
} from '@/stores/signboard'
import { ColumnLane } from '@/views/signboard/column-lane'
import styles from '@/views/signboard/signboard.module.scss'

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

function parseSemantic(title: string, index: number) {
  if (title.includes('完成') || title.toLowerCase().includes('done')) return 'done' as const
  if (title.includes('进行') || title.toLowerCase().includes('doing')) return 'doing' as const
  if (index === 0 || title.includes('待办')) return 'todo' as const
  return 'other' as const
}

function KanbanView(props: KanbanViewProps) {
  const entriesInColumn = useSignboardStore(function (state) {
    return state.entriesInColumn
  })
  const toMoveEntry = useSignboardStore(function (state) {
    return state.toMoveEntry
  })
  const toWriteEntry = useSignboardStore(function (state) {
    return state.toWriteEntry
  })
  const checksForEntry = useSignboardStore(function (state) {
    return state.checksForEntry
  })

  const [activeDragID, setActiveDragID] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  function resolveTarget(event: DragEndEvent | DragOverEvent) {
    const { active, over } = event
    if (!over) return null
    const activeID = String(active.id)
    const overID = String(over.id)
    const overData = over.data.current as { type?: string; columnID?: string } | undefined

    let toColumnID = overData?.columnID
    if (!toColumnID) {
      const overCard = props.entries.find(function (card) {
        return card.id === overID
      })
      toColumnID = overCard?.columnID
    }
    if (
      !toColumnID &&
      props.columns.some(function (column) {
        return column.id === overID
      })
    ) {
      toColumnID = overID
    }
    if (!toColumnID) return null

    const destCards = entriesInColumn(toColumnID).filter(function (card) {
      return card.id !== activeID
    })
    let toIndex = destCards.length
    const overCardIndex = destCards.findIndex(function (card) {
      return card.id === overID
    })
    if (overCardIndex >= 0) toIndex = overCardIndex

    return { activeID, toColumnID, toIndex }
  }

  function onDragStart(event: DragStartEvent) {
    setActiveDragID(String(event.active.id))
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveDragID(null)
    const target = resolveTarget(event)
    if (!target) return
    const moving = props.entries.find(function (card) {
      return card.id === target.activeID
    })
    if (
      moving &&
      moving.columnID === target.toColumnID &&
      moving.index === target.toIndex
    ) {
      return
    }
    void toMoveEntry(target.activeID, target.toColumnID, target.toIndex).then(function (ok) {
      if (!ok) toast.error('没能保存顺序，已恢复')
    })
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
    const columnCards = entriesInColumn(card.columnID)
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
      const dest = props.columns[colIndex - 1]!
      void toMoveEntry(entryID, dest.id, entriesInColumn(dest.id).length)
    }
    if (event.key === 'ArrowRight' && colIndex < props.columns.length - 1) {
      event.preventDefault()
      const dest = props.columns[colIndex + 1]!
      void toMoveEntry(entryID, dest.id, entriesInColumn(dest.id).length)
    }
  }

  const dragCard = props.entries.find(function (card) {
    return card.id === activeDragID
  })

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}>
      <div className={styles.board}>
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
          props.columns.map(function (column) {
            return (
              <ColumnLane
                key={column.id}
                column={column}
                entries={entriesInColumn(column.id)}
                tagsByCard={props.tagsByCard}
                checksForEntry={checksForEntry}
                isDimmedCard={props.isDimmedCard}
                selectedCardID={props.selectedCardID}
                semantic={parseSemantic(column.title, column.index)}
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
          })
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

      <DragOverlay dropAnimation={null}>
        {dragCard ? (
          <div className={styles.overlayCard}>
            <p className="text-sm font-medium">{dragCard.title}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

export { KanbanView }
