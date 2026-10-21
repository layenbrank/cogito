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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { Spinner } from '@i-thinking/design/components/spinner'
import { debounce } from 'lodash-es'
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { useSignboardStore, type SignboardColumn, type SignboardTag } from '@/stores/signboard'
import { CardSheet } from '@/views/signboard/card-sheet'
import { ColumnLane } from '@/views/signboard/column-lane'
import { EmptyAtmosphere } from '@/views/signboard/empty-atmosphere'
import { NameDialog } from '@/views/signboard/name-dialog'
import styles from '@/views/signboard/signboard.module.scss'

function parseSemantic(title: string, index: number) {
  if (title.includes('完成') || title.toLowerCase().includes('done')) return 'done' as const
  if (title.includes('进行') || title.toLowerCase().includes('doing')) return 'doing' as const
  if (index === 0 || title.includes('待办')) return 'todo' as const
  return 'other' as const
}

type NameDialogState =
  | { kind: 'board-create' }
  | { kind: 'board-rename'; boardID: string; title: string }
  | { kind: 'column-rename'; column: SignboardColumn }
  | null

function BoardView() {
  const boards = useSignboardStore(function (state) {
    return state.boards
  })
  const columns = useSignboardStore(function (state) {
    return state.columns
  })
  const cards = useSignboardStore(function (state) {
    return state.cards
  })
  const tags = useSignboardStore(function (state) {
    return state.tags
  })
  const activeBoardID = useSignboardStore(function (state) {
    return state.activeBoardID
  })
  const loaded = useSignboardStore(function (state) {
    return state.loaded
  })
  const toBootstrap = useSignboardStore(function (state) {
    return state.toBootstrap
  })
  const toActivateBoard = useSignboardStore(function (state) {
    return state.toActivateBoard
  })
  const toWriteBoard = useSignboardStore(function (state) {
    return state.toWriteBoard
  })
  const toUpdateBoard = useSignboardStore(function (state) {
    return state.toUpdateBoard
  })
  const toWriteColumn = useSignboardStore(function (state) {
    return state.toWriteColumn
  })
  const toUpdateColumn = useSignboardStore(function (state) {
    return state.toUpdateColumn
  })
  const toWriteCard = useSignboardStore(function (state) {
    return state.toWriteCard
  })
  const toUpdateCard = useSignboardStore(function (state) {
    return state.toUpdateCard
  })
  const toMoveCard = useSignboardStore(function (state) {
    return state.toMoveCard
  })
  const cardsInColumn = useSignboardStore(function (state) {
    return state.cardsInColumn
  })
  const tagIDsForCard = useSignboardStore(function (state) {
    return state.tagIDsForCard
  })

  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<'all' | string>('all')
  const [dueOnly, setDueOnly] = useState(false)
  const [selectedCardID, setSelectedCardID] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [activeDragID, setActiveDragID] = useState<string | null>(null)
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null)
  const [addingColumn, setAddingColumn] = useState(false)
  const [columnDraft, setColumnDraft] = useState('')
  const [addRequestColumnID, setAddRequestColumnID] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const applySearch = useMemo(
    function () {
      return debounce(function (value: string) {
        setQuery(value)
      }, 200)
    },
    []
  )

  useEffect(
    function () {
      void toBootstrap()
    },
    [toBootstrap]
  )

  useEffect(
    function () {
      return function () {
        applySearch.cancel()
      }
    },
    [applySearch]
  )

  const orderedColumns = useMemo(
    function () {
      return columns.slice().sort(function (a, b) {
        return a.index - b.index
      })
    },
    [columns]
  )

  const activeBoard = boards.find(function (board) {
    return board.id === activeBoardID
  })

  const tagsByCard = useMemo(
    function () {
      const map = new Map<string, SignboardTag[]>()
      for (const card of cards) {
        const ids = tagIDsForCard(card.id)
        map.set(
          card.id,
          tags.filter(function (tag) {
            return ids.includes(tag.id)
          })
        )
      }
      return map
    },
    [cards, tags, tagIDsForCard]
  )

  function isDimmedCard(cardID: string) {
    const card = cards.find(function (row) {
      return row.id === cardID
    })
    if (!card) return true
    const q = query.trim().toLowerCase()
    if (q) {
      const hay = `${card.title} ${card.notes}`.toLowerCase()
      if (!hay.includes(q)) return true
    }
    if (dueOnly && card.dueAt == null) return true
    if (tagFilter !== 'all') {
      const ids = tagIDsForCard(cardID)
      if (!ids.includes(tagFilter)) return true
    }
    return false
  }

  function openCard(cardID: string) {
    setSelectedCardID(cardID)
    setSheetOpen(true)
  }

  function onDragStart(event: DragStartEvent) {
    setActiveDragID(String(event.active.id))
  }

  function resolveTarget(event: DragEndEvent | DragOverEvent) {
    const { active, over } = event
    if (!over) return null
    const activeID = String(active.id)
    const overID = String(over.id)
    const overData = over.data.current as { type?: string; columnID?: string } | undefined

    let toColumnID = overData?.columnID
    if (!toColumnID) {
      const overCard = cards.find(function (card) {
        return card.id === overID
      })
      toColumnID = overCard?.columnID
    }
    if (
      !toColumnID &&
      orderedColumns.some(function (column) {
        return column.id === overID
      })
    ) {
      toColumnID = overID
    }
    if (!toColumnID) return null

    const destCards = cardsInColumn(toColumnID).filter(function (card) {
      return card.id !== activeID
    })
    let toIndex = destCards.length
    const overCardIndex = destCards.findIndex(function (card) {
      return card.id === overID
    })
    if (overCardIndex >= 0) toIndex = overCardIndex

    return { activeID, toColumnID, toIndex }
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveDragID(null)
    const target = resolveTarget(event)
    if (!target) return
    const moving = cards.find(function (card) {
      return card.id === target.activeID
    })
    if (
      moving &&
      moving.columnID === target.toColumnID &&
      moving.index === target.toIndex
    ) {
      return
    }
    void toMoveCard(target.activeID, target.toColumnID, target.toIndex).then(function (ok) {
      if (!ok) toast.error('没能保存顺序，已恢复')
    })
  }

  function onKeyMove(cardID: string, event: KeyboardEvent) {
    const meta = event.metaKey || event.ctrlKey
    if (!meta) {
      if (event.key === 'Enter') {
        event.preventDefault()
        openCard(cardID)
      }
      return
    }

    const card = cards.find(function (row) {
      return row.id === cardID
    })
    if (!card) return
    const colIndex = orderedColumns.findIndex(function (column) {
      return column.id === card.columnID
    })
    if (colIndex < 0) return
    const columnCards = cardsInColumn(card.columnID)
    const index = columnCards.findIndex(function (row) {
      return row.id === cardID
    })

    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault()
      void toMoveCard(cardID, card.columnID, index - 1)
    }
    if (event.key === 'ArrowDown' && index < columnCards.length - 1) {
      event.preventDefault()
      void toMoveCard(cardID, card.columnID, index + 1)
    }
    if (event.key === 'ArrowLeft' && colIndex > 0) {
      event.preventDefault()
      const dest = orderedColumns[colIndex - 1]!
      void toMoveCard(cardID, dest.id, cardsInColumn(dest.id).length)
    }
    if (event.key === 'ArrowRight' && colIndex < orderedColumns.length - 1) {
      event.preventDefault()
      const dest = orderedColumns[colIndex + 1]!
      void toMoveCard(cardID, dest.id, cardsInColumn(dest.id).length)
    }
  }

  useEffect(
    function () {
      function onGlobalKey(event: globalThis.KeyboardEvent) {
        const target = event.target as HTMLElement | null
        const tag = target?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return

        const meta = event.metaKey || event.ctrlKey
        if (meta && event.key.toLowerCase() === 'n') {
          event.preventDefault()
          const first = orderedColumns[0]
          if (first) setAddRequestColumnID(first.id)
        }
        if (meta && event.key.toLowerCase() === 'f') {
          event.preventDefault()
          document.getElementById('signboard-search')?.focus()
        }
      }
      window.addEventListener('keydown', onGlobalKey)
      return function () {
        window.removeEventListener('keydown', onGlobalKey)
      }
    },
    [orderedColumns]
  )

  async function commitColumn() {
    const title = columnDraft.trim()
    if (!title || !activeBoardID) return
    const id = await toWriteColumn(activeBoardID, title)
    if (!id) {
      toast.error('添加列失败')
      return
    }
    setColumnDraft('')
    setAddingColumn(false)
    toast.success('已添加列')
  }

  async function archiveCard(cardID: string) {
    const ok = await toUpdateCard(cardID, { archivedAt: Date.now() })
    if (!ok) {
      toast.error('归档失败')
      return
    }
    toast.success('已归档卡片')
  }

  async function archiveColumn(columnID: string) {
    const count = cardsInColumn(columnID).length
    if (count > 0) {
      toast.error('请先清空或移走列中的卡片')
      return
    }
    const ok = await toUpdateColumn(columnID, { archivedAt: Date.now() })
    if (!ok) {
      toast.error('归档列失败')
      return
    }
    toast.success('已归档列')
  }

  const activeCard = cards.find(function (card) {
    return card.id === selectedCardID
  })
  const dragCard = cards.find(function (card) {
    return card.id === activeDragID
  })

  if (!loaded) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-5" />
        加载看板…
      </div>
    )
  }

  return (
    <div className={styles.root}>
      {orderedColumns.length === 0 ? <EmptyAtmosphere /> : null}

      <div className={styles.chrome}>
        <div className={styles.chromeMeta}>
          <div className="flex items-center gap-2">
            <Select
              items={boards.map(function (board) {
                return { value: board.id, label: board.title }
              })}
              value={activeBoardID}
              onValueChange={function (value) {
                if (value === null) return
                void toActivateBoard(value)
              }}>
              <SelectTrigger className="h-9 w-[168px]">
                <SelectValue placeholder="选择看板" />
              </SelectTrigger>
              <SelectContent>
                {boards.map(function (board) {
                  return (
                    <SelectItem
                      key={board.id}
                      value={board.id}>
                      {board.title}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              disabled={!activeBoard}
              onClick={function () {
                if (!activeBoard) return
                setNameDialog({
                  kind: 'board-rename',
                  boardID: activeBoard.id,
                  title: activeBoard.title
                })
              }}>
              <Icon
                icon="lucide:pencil"
                className="size-3.5"
              />
            </Button>
          </div>
          <p className={styles.chromeHint}>
            {activeBoard?.title ?? '看板'} · {cards.length} 张卡片 · {orderedColumns.length} 列
          </p>
        </div>

        <div className={styles.filters}>
          <Input
            id="signboard-search"
            className="h-9 w-[200px]"
            placeholder="搜索标题或备注…"
            value={search}
            onChange={function (event) {
              setSearch(event.target.value)
              applySearch(event.target.value)
            }}
          />
          <Button
            type="button"
            size="sm"
            variant={dueOnly ? 'default' : 'outline'}
            onClick={function () {
              setDueOnly(function (prev) {
                return !prev
              })
            }}>
            <Icon
              icon="lucide:calendar-clock"
              className="size-3.5"
            />
            有到期
          </Button>
          {tags.map(function (tag) {
            return (
              <Button
                key={tag.id}
                type="button"
                size="sm"
                variant={tagFilter === tag.id ? 'default' : 'outline'}
                onClick={function () {
                  setTagFilter(function (prev) {
                    return prev === tag.id ? 'all' : tag.id
                  })
                }}>
                {tag.title}
              </Button>
            )
          })}
        </div>

        <div className={styles.chromeActions}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={function () {
              setNameDialog({ kind: 'board-create' })
            }}>
            <Icon
              icon="lucide:layout-dashboard"
              className="size-3.5"
            />
            新建看板
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={function () {
              setAddingColumn(true)
            }}>
            <Icon
              icon="lucide:columns-3"
              className="size-3.5"
            />
            添加列
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={function () {
              const first = orderedColumns[0]
              if (!first) {
                setAddingColumn(true)
                toast.message('请先添加一列')
                return
              }
              setAddRequestColumnID(first.id)
            }}>
            <Icon
              icon="lucide:plus"
              className="size-3.5"
            />
            新建卡片
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}>
        <div className={styles.board}>
          {orderedColumns.length === 0 ? (
            <div className={styles.emptyBoard}>
              <div className={styles.emptyIcon}>
                <Icon
                  icon="lucide:kanban"
                  className="size-5"
                />
              </div>
              <p className={styles.emptyTitle}>还没有列</p>
              <p className={styles.emptyDesc}>先建一列工作流状态，再把事情放进去。默认可用「待办 / 进行中 / 完成」。</p>
              <Button
                type="button"
                onClick={function () {
                  setAddingColumn(true)
                }}>
                添加第一列
              </Button>
            </div>
          ) : (
            orderedColumns.map(function (column) {
              return (
                <ColumnLane
                  key={column.id}
                  column={column}
                  cards={cardsInColumn(column.id)}
                  tagsByCard={tagsByCard}
                  isDimmedCard={isDimmedCard}
                  selectedCardID={selectedCardID}
                  semantic={parseSemantic(column.title, column.index)}
                  requestAdd={addRequestColumnID === column.id}
                  onConsumedAddRequest={function () {
                    setAddRequestColumnID(null)
                  }}
                  onOpenCard={openCard}
                  onFocusCard={setSelectedCardID}
                  onKeyMove={onKeyMove}
                  onWriteCard={async function (columnID, title) {
                    const id = await toWriteCard({ columnID, title })
                    if (!id) {
                      toast.error('添加卡片失败')
                      return
                    }
                    toast.success('已添加卡片')
                  }}
                  onRenameColumn={function (column) {
                    setNameDialog({ kind: 'column-rename', column })
                  }}
                  onArchiveColumn={function (columnID) {
                    void archiveColumn(columnID)
                  }}
                  onArchiveCard={function (cardID) {
                    void archiveCard(cardID)
                  }}
                />
              )
            })
          )}

          {addingColumn || orderedColumns.length > 0 ? (
            <div className={styles.addColumn}>
              {addingColumn ? (
                <>
                  <Input
                    autoFocus
                    value={columnDraft}
                    placeholder="列名称，例如：评审中"
                    className="h-9"
                    onChange={function (event) {
                      setColumnDraft(event.target.value)
                    }}
                    onKeyDown={function (event) {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void commitColumn()
                      }
                      if (event.key === 'Escape') {
                        setAddingColumn(false)
                        setColumnDraft('')
                      }
                    }}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="flex-1"
                      onClick={function () {
                        void commitColumn()
                      }}>
                      添加
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={function () {
                        setAddingColumn(false)
                        setColumnDraft('')
                      }}>
                      取消
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 justify-start text-muted-foreground"
                  onClick={function () {
                    setAddingColumn(true)
                  }}>
                  <Icon
                    icon="lucide:plus"
                    className="size-3.5"
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

      <p className={styles.footerHint}>
        手柄拖拽跨列 · ⌘/Ctrl+N 在首列新建 · ⌘/Ctrl+F 搜索 · 选中卡片后 ⌘/Ctrl+↑↓←→ 移动
      </p>

      <CardSheet
        card={activeCard ?? null}
        open={sheetOpen}
        onUpdateOpen={setSheetOpen}
      />

      <NameDialog
        open={nameDialog?.kind === 'board-create'}
        title="新建看板"
        description="用于区分工作流主题，例如个人、副业或项目代号。"
        placeholder="例如：本周交付"
        confirmLabel="创建"
        onClose={function () {
          setNameDialog(null)
        }}
        onConfirm={async function (title) {
          const id = await toWriteBoard(title)
          if (!id) {
            toast.error('创建看板失败')
            throw new Error('create board failed')
          }
          toast.success('已创建看板')
        }}
      />

      <NameDialog
        open={nameDialog?.kind === 'board-rename'}
        title="重命名看板"
        initialValue={nameDialog?.kind === 'board-rename' ? nameDialog.title : ''}
        confirmLabel="保存"
        onClose={function () {
          setNameDialog(null)
        }}
        onConfirm={async function (title) {
          if (nameDialog?.kind !== 'board-rename') return
          const ok = await toUpdateBoard(nameDialog.boardID, { title })
          if (!ok) {
            toast.error('重命名失败')
            throw new Error('rename board failed')
          }
          toast.success('已重命名')
        }}
      />

      <NameDialog
        open={nameDialog?.kind === 'column-rename'}
        title="重命名列"
        initialValue={nameDialog?.kind === 'column-rename' ? nameDialog.column.title : ''}
        confirmLabel="保存"
        onClose={function () {
          setNameDialog(null)
        }}
        onConfirm={async function (title) {
          if (nameDialog?.kind !== 'column-rename') return
          const ok = await toUpdateColumn(nameDialog.column.id, { title })
          if (!ok) {
            toast.error('重命名失败')
            throw new Error('rename column failed')
          }
          toast.success('已重命名列')
        }}
      />
    </div>
  )
}

export { BoardView }
