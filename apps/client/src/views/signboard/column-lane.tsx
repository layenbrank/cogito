import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { Input } from '@i-thinking/design/components/input'
import { clsx } from 'clsx'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import type { SignboardCard, SignboardColumn, SignboardTag } from '@/stores/signboard'
import { CardItem } from '@/views/signboard/card-item'
import styles from '@/views/signboard/signboard.module.scss'

interface ColumnLaneProps {
  column: SignboardColumn
  cards: SignboardCard[]
  tagsByCard: Map<string, SignboardTag[]>
  isDimmedCard: (cardID: string) => boolean
  selectedCardID: string | null
  semantic: 'todo' | 'doing' | 'done' | 'other'
  requestAdd?: boolean
  onConsumedAddRequest?: () => void
  onOpenCard: (cardID: string) => void
  onFocusCard: (cardID: string) => void
  onKeyMove: (cardID: string, event: KeyboardEvent) => void
  onWriteCard: (columnID: string, title: string) => Promise<void>
  onRenameColumn: (column: SignboardColumn) => void
  onArchiveColumn: (columnID: string) => void
  onArchiveCard: (cardID: string) => void
}

function ColumnLane(props: ColumnLaneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: props.column.id,
    data: { type: 'column', columnID: props.column.id }
  })
  const [isAdding, setIsAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const cardIDs = props.cards.map(function (card) {
    return card.id
  })

  useEffect(
    function () {
      if (!props.requestAdd) return
      setIsAdding(true)
      props.onConsumedAddRequest?.()
      requestAnimationFrame(function () {
        inputRef.current?.focus()
      })
    },
    [props.requestAdd, props.onConsumedAddRequest]
  )

  async function commit() {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await props.onWriteCard(props.column.id, title)
    setIsAdding(true)
    requestAnimationFrame(function () {
      inputRef.current?.focus()
    })
  }

  return (
    <section className={clsx(styles.column, isOver && styles.columnOver)}>
      <header className={styles.columnHeader}>
        <h3 className={styles.columnTitle}>
          <span
            className={clsx(
              styles.columnDot,
              props.semantic === 'doing' && styles.columnDotDoing,
              props.semantic === 'done' && styles.columnDotDone
            )}
          />
          <span className="truncate">{props.column.title}</span>
        </h3>
        <span className={styles.columnCount}>{props.cards.length}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-muted hover:opacity-100"
            aria-label="列菜单">
            <Icon
              icon="lucide:more-horizontal"
              className="size-4"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={function () {
                props.onRenameColumn(props.column)
              }}>
              <Icon
                icon="lucide:pencil"
                className="size-4"
              />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={function () {
                setIsAdding(true)
                requestAnimationFrame(function () {
                  inputRef.current?.focus()
                })
              }}>
              <Icon
                icon="lucide:plus"
                className="size-4"
              />
              添加卡片
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={function () {
                props.onArchiveColumn(props.column.id)
              }}>
              <Icon
                icon="lucide:archive"
                className="size-4"
              />
              归档列
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <SortableContext
        id={props.column.id}
        items={cardIDs}
        strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={styles.cards}>
          {props.cards.length === 0 ? (
            <li className={clsx(styles.cardsEmpty, 'list-none')}>拖到这里，或点下方添加</li>
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
                onArchive={props.onArchiveCard}
              />
            )
          })}
        </ul>
      </SortableContext>

      <div className="px-2 pb-3">
        {isAdding ? (
          <Input
            ref={inputRef}
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
            <Icon
              icon="lucide:plus"
              className="size-3.5"
            />
            添加卡片
          </Button>
        )}
      </div>
    </section>
  )
}

export { ColumnLane }
