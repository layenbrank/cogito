import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { clsx } from 'clsx'
import type { KeyboardEvent } from 'react'

import type { SignboardCard, SignboardTag } from '@/stores/signboard'

interface CardItemProps {
  card: SignboardCard
  tags: SignboardTag[]
  isDimmed: boolean
  isSelected: boolean
  onOpen: (cardID: string) => void
  onFocusCard: (cardID: string) => void
  onKeyMove: (cardID: string, event: KeyboardEvent) => void
}

function formatDue(dueAt: number) {
  const date = new Date(dueAt)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

function dueTone(dueAt: number | null) {
  if (dueAt == null) return null
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  if (dueAt < start.getTime()) return 'overdue'
  const end = start.getTime() + 24 * 60 * 60 * 1000
  if (dueAt < end) return 'today'
  return 'later'
}

function CardItem(props: CardItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.card.id,
    data: { type: 'card', columnID: props.card.columnID }
  })

  const tone = dueTone(props.card.dueAt)
  const visibleTags = props.tags.slice(0, 2)

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
      className={clsx(
        'mb-2 list-none rounded-[var(--radius)] border border-border bg-card p-3 shadow-xs',
        'cursor-grab touch-none transition-[box-shadow,opacity,transform] duration-150',
        'hover:-translate-y-px hover:shadow-sm focus-visible:outline-2 focus-visible:outline-ring',
        isDragging && 'opacity-40',
        props.isDimmed && 'opacity-30',
        props.isSelected && 'outline-2 outline-ring'
      )}
      tabIndex={0}
      {...attributes}
      {...listeners}
      onClick={function () {
        props.onOpen(props.card.id)
      }}
      onFocus={function () {
        props.onFocusCard(props.card.id)
      }}
      onKeyDown={function (event) {
        props.onKeyMove(props.card.id, event)
      }}>
      <p className="mb-2 text-sm font-medium leading-snug text-foreground">{props.card.title}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {visibleTags.map(function (tag) {
          return (
            <span
              key={tag.id}
              className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {tag.title}
            </span>
          )
        })}
        {props.card.dueAt != null ? (
          <span
            className={clsx(
              'rounded-md px-2 py-0.5 text-[11px] font-medium',
              tone === 'overdue' && 'bg-destructive/15 text-destructive',
              tone === 'today' && 'bg-warning/25 text-warning-foreground',
              tone === 'later' && 'bg-muted text-muted-foreground'
            )}>
            {formatDue(props.card.dueAt)}
          </span>
        ) : null}
      </div>
    </li>
  )
}

export { CardItem }
