import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { clsx } from 'clsx'
import { useState, type KeyboardEvent } from 'react'

import type { SignboardCard, SignboardColumn, SignboardTag } from '@/stores/signboard'
import { CardItem } from '@/views/signboard/card-item'

interface ColumnLaneProps {
  column: SignboardColumn
  cards: SignboardCard[]
  tagsByCard: Map<string, SignboardTag[]>
  isDimmedCard: (cardID: string) => boolean
  selectedCardID: string | null
  semantic: 'todo' | 'doing' | 'done' | 'other'
  onOpenCard: (cardID: string) => void
  onFocusCard: (cardID: string) => void
  onKeyMove: (cardID: string, event: KeyboardEvent) => void
  onWriteCard: (columnID: string, title: string) => Promise<void>
}

function ColumnLane(props: ColumnLaneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: props.column.id,
    data: { type: 'column', columnID: props.column.id }
  })
  const [isAdding, setIsAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const cardIDs = props.cards.map(function (card) {
    return card.id
  })

  async function commit() {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await props.onWriteCard(props.column.id, title)
    setIsAdding(true)
  }

  return (
    <section
      className={clsx(
        'flex max-h-full w-[288px] shrink-0 flex-col rounded-[calc(var(--radius)+2px)]',
        'border border-border/80 bg-muted/50',
        isOver && 'border-primary/45 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_25%,transparent)]'
      )}>
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold">
          <span
            className={clsx(
              'size-2 rounded-full',
              props.semantic === 'done' && 'bg-success',
              props.semantic === 'doing' && 'bg-primary',
              props.semantic === 'todo' && 'bg-muted-foreground',
              props.semantic === 'other' && 'bg-muted-foreground'
            )}
          />
          {props.column.title}
        </h3>
        <span className="ml-auto text-xs font-medium text-muted-foreground">{props.cards.length}</span>
      </header>

      <SortableContext
        id={props.column.id}
        items={cardIDs}
        strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className="min-h-12 flex-1 overflow-y-auto px-2 pb-2">
          {props.cards.length === 0 ? (
            <li className="mx-1 my-1 list-none rounded-[var(--radius)] border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
              拖到这里，或点下方添加
            </li>
          ) : null}
          {props.cards.map(function (card) {
            return (
              <CardItem
                key={card.id}
                card={card}
                tags={props.tagsByCard.get(card.id) ?? []}
                isDimmed={props.isDimmedCard(card.id)}
                isSelected={props.selectedCardID === card.id}
                onOpen={props.onOpenCard}
                onFocusCard={props.onFocusCard}
                onKeyMove={props.onKeyMove}
              />
            )
          })}
        </ul>
      </SortableContext>

      <div className="px-2 pb-3">
        {isAdding ? (
          <Input
            autoFocus
            value={draft}
            placeholder="卡片标题，Enter 添加"
            className="h-9"
            onChange={function (event) {
              setDraft(event.target.value)
            }}
            onKeyDown={function (event) {
              if (event.key === 'Enter') {
                event.preventDefault()
                void commit()
              }
              if (event.key === 'Escape') {
                setIsAdding(false)
                setDraft('')
              }
            }}
            onBlur={function () {
              if (!draft.trim()) setIsAdding(false)
            }}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-full border border-dashed border-border text-muted-foreground"
            onClick={function () {
              setIsAdding(true)
            }}>
            添加卡片
          </Button>
        )}
      </div>
    </section>
  )
}

export { ColumnLane }
