import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { Input } from '@cogito/design/components/input'
import { clsx } from 'clsx'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import type {
  SignboardEntry,
  SignboardCheck,
  SignboardColumn,
  SignboardTag
} from '@/stores/signboard'
import { CardItem } from '@/views/signboard/card-item'
import styles from '@/views/signboard/signboard.module.scss'

interface ColumnLaneProps {
  column: SignboardColumn
  entries: SignboardEntry[]
  tagsByCard: Map<string, SignboardTag[]>
  checksForEntry: (entryID: string) => SignboardCheck[]
  coverSrcByCard: Map<string, string>
  attachmentCountByCard: Map<string, number>
  dropBeforeID: string | null
  isDimmedCard: (entryID: string) => boolean
  selectedCardID: string | null
  semantic: 'todo' | 'doing' | 'done' | 'other'
  requestAdd?: boolean
  onConsumedAddRequest?: () => void
  onOpenCard: (entryID: string) => void
  onFocusCard: (entryID: string) => void
  onKeyMove: (entryID: string, event: KeyboardEvent) => void
  onWriteCard: (columnID: string, title: string) => Promise<void>
  onRenameColumn: (column: SignboardColumn) => void
  onArchiveColumn: (columnID: string) => void
  onArchiveCard: (entryID: string) => void
}

function ColumnLane(props: ColumnLaneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: props.column.id,
    data: { type: 'column', columnID: props.column.id }
  })
  const [isAdding, setIsAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { requestAdd, onConsumedAddRequest } = props

  if (requestAdd && !isAdding) {
    setIsAdding(true)
  }

  const cardIDs = props.entries.map(function (card) {
    return card.id
  })

  useEffect(
    function () {
      if (!requestAdd) return
      onConsumedAddRequest?.()
      requestAnimationFrame(function () {
        inputRef.current?.focus()
      })
    },
    [requestAdd, onConsumedAddRequest]
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
              styles.columnIcon,
              props.semantic === 'doing' && styles.columnIconDoing,
              props.semantic === 'done' && styles.columnIconDone
            )}
            aria-hidden>
            <Icon
              icon={
                props.semantic === 'done'
                  ? 'lucide:check'
                  : props.semantic === 'doing'
                    ? 'lucide:circle-dot'
                    : props.semantic === 'todo'
                      ? 'lucide:circle'
                      : 'lucide:columns-3'
              }
              className="size-3"
            />
          </span>
          <span className="truncate">{props.column.title}</span>
          <span className={styles.columnCount}>({props.entries.length})</span>
        </h3>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={styles.menuTrigger}
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
          {props.entries.map(function (card) {
            return (
              <CardItem
                key={card.id}
                card={card}
                tags={props.tagsByCard.get(card.id) ?? []}
                checklist={props.checksForEntry(card.id)}
                coverSrc={props.coverSrcByCard.get(card.id) ?? null}
                attachmentCount={props.attachmentCountByCard.get(card.id) ?? 0}
                showDropBefore={props.dropBeforeID === card.id}
                isDimmed={props.isDimmedCard(card.id)}
                isSelected={props.selectedCardID === card.id}
                onOpen={props.onOpenCard}
                onFocusCard={props.onFocusCard}
                onKeyMove={props.onKeyMove}
                onArchive={props.onArchiveCard}
              />
            )
          })}
          {props.dropBeforeID === props.column.id ? (
            <li
              className={styles.dropWell}
              aria-hidden
            />
          ) : null}
        </ul>
      </SortableContext>

      <div className={styles.columnFooter}>
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
            size="lg"
            variant="outline"
            className={styles.addCard}
            onClick={function () {
              setIsAdding(true)
            }}>
            <Icon
              icon="lucide:plus"
              className="size-4"
            />
            添加卡片
          </Button>
        )}
      </div>
    </section>
  )
}

export { ColumnLane }
