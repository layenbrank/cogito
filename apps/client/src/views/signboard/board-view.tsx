import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { debounce } from 'lodash-es'
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'

import { useSignboardStore, type SignboardTag } from '@/stores/signboard'
import { CardSheet } from '@/views/signboard/card-sheet'
import { ColumnLane } from '@/views/signboard/column-lane'
import { EmptyAtmosphere } from '@/views/signboard/empty-atmosphere'

function parseSemantic(title: string, index: number) {
  if (title.includes('完成') || title.toLowerCase().includes('done')) return 'done' as const
  if (title.includes('进行') || title.toLowerCase().includes('doing')) return 'doing' as const
  if (index === 0 || title.includes('待办')) return 'todo' as const
  return 'other' as const
}

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
  const toWriteColumn = useSignboardStore(function (state) {
    return state.toWriteColumn
  })
  const toWriteCard = useSignboardStore(function (state) {
    return state.toWriteCard
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
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
    if (!toColumnID && orderedColumns.some(function (column) {
      return column.id === overID
    })) {
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
    void toMoveCard(target.activeID, target.toColumnID, target.toIndex)
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
        const meta = event.metaKey || event.ctrlKey
        if (meta && event.key.toLowerCase() === 'n') {
          event.preventDefault()
          const first = orderedColumns[0]
          if (!first) return
          const title = window.prompt('新卡片标题')
          if (title?.trim()) void toWriteCard({ columnID: first.id, title: title.trim() })
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
    [orderedColumns, toWriteCard]
  )

  const activeCard = cards.find(function (card) {
    return card.id === selectedCardID
  })
  const dragCard = cards.find(function (card) {
    return card.id === activeDragID
  })

  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {orderedColumns.length === 0 || cards.length === 0 ? <EmptyAtmosphere /> : null}

      <div className="relative z-[1] flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Select
          items={boards.map(function (board) {
            return { value: board.id, label: board.title }
          })}
          value={activeBoardID}
          onValueChange={function (value) {
            if (value === null) return
            void toActivateBoard(value)
          }}>
          <SelectTrigger className="h-9 w-[160px]">
            <SelectValue placeholder="看板" />
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

        <Input
          id="signboard-search"
          className="h-9 max-w-[240px] flex-1"
          placeholder="搜索卡片…"
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

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={function () {
            const title = window.prompt('新看板名称')
            if (title?.trim()) void toWriteBoard(title.trim())
          }}>
          新建看板
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={function () {
            if (!activeBoardID) return
            const title = window.prompt('新列名称')
            if (title?.trim()) void toWriteColumn(activeBoardID, title.trim())
          }}>
          添加列
        </Button>

        <Button
          type="button"
          className="ml-auto"
          size="sm"
          onClick={function () {
            const first = orderedColumns[0]
            if (!first) return
            const title = window.prompt('新卡片标题')
            if (title?.trim()) void toWriteCard({ columnID: first.id, title: title.trim() })
          }}>
          新建卡片
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}>
        <div className="relative z-[1] flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
          {orderedColumns.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <p>还没有列。先建一列，再把事情放进去。</p>
              <Button
                type="button"
                onClick={function () {
                  if (!activeBoardID) return
                  void toWriteColumn(activeBoardID, '待办')
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
                  onOpenCard={openCard}
                  onFocusCard={setSelectedCardID}
                  onKeyMove={onKeyMove}
                  onWriteCard={async function (columnID, title) {
                    await toWriteCard({ columnID, title })
                  }}
                />
              )
            })
          )}
        </div>

        <DragOverlay>
          {dragCard ? (
            <div className="w-[264px] rounded-[var(--radius)] border border-border bg-card p-3 shadow-md">
              <p className="text-sm font-medium">{dragCard.title}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <p className="relative z-[1] px-4 pb-3 text-xs text-muted-foreground">
        拖拽跨列；⌘/Ctrl+N 新建；选中卡片后 ⌘/Ctrl+↑↓←→ 移动。
      </p>

      <CardSheet
        card={activeCard ?? null}
        open={sheetOpen}
        onUpdateOpen={setSheetOpen}
      />
    </div>
  )
}

export { BoardView }
