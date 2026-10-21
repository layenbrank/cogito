import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Icon } from '@iconify/react/offline'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { clsx } from 'clsx'
import type { KeyboardEvent } from 'react'

import type {
  SignboardEntry,
  SignboardCheck,
  SignboardTag
} from '@/stores/signboard'
import styles from '@/views/signboard/signboard.module.scss'

interface CardItemProps {
  card: SignboardEntry
  tags: SignboardTag[]
  checklist: SignboardCheck[]
  isDimmed: boolean
  isSelected: boolean
  onOpen: (entryID: string) => void
  onFocusCard: (entryID: string) => void
  onKeyMove: (entryID: string, event: KeyboardEvent) => void
  onArchive: (entryID: string) => void
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
  const checklistTotal = props.checklist.length
  const checklistDone = props.checklist.filter(function (item) {
    return item.done
  }).length

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
      className={clsx(
        styles.card,
        isDragging && styles.cardDragging,
        props.isDimmed && styles.cardDimmed,
        props.isSelected && styles.cardSelected
      )}
      tabIndex={0}
      onFocus={function () {
        props.onFocusCard(props.card.id)
      }}
      onKeyDown={function (event) {
        props.onKeyMove(props.card.id, event)
      }}>
      <button
        type="button"
        className={styles.handle}
        aria-label="拖拽卡片"
        {...attributes}
        {...listeners}>
        <Icon
          icon="lucide:grip-vertical"
          className="size-4"
        />
      </button>

      <div
        className={styles.cardBody}
        onClick={function () {
          props.onOpen(props.card.id)
        }}>
        <p className={styles.cardTitle}>{props.card.title}</p>
        <div className={styles.cardMeta}>
          {visibleTags.map(function (tag) {
            return (
              <span
                key={tag.id}
                className={styles.tag}>
                {tag.title}
              </span>
            )
          })}
          {props.card.dueAt != null ? (
            <span
              className={clsx(
                styles.due,
                tone === 'overdue' && styles.dueOverdue,
                tone === 'today' && styles.dueToday
              )}>
              <Icon
                icon="lucide:calendar"
                className="size-3"
                aria-hidden
              />
              {formatDue(props.card.dueAt)}
            </span>
          ) : null}
          {checklistTotal > 0 ? (
            <span className={styles.checklistBadge}>
              <Icon
                icon="lucide:list-checks"
                className="size-3"
                aria-hidden
              />
              {checklistDone}/{checklistTotal}
            </span>
          ) : null}
          {props.card.priority > 0 ? (
            <span className={styles.priorityBadge}>P{props.card.priority}</span>
          ) : null}
          {props.card.reminderID ? (
            <Icon
              icon="lucide:bell"
              className="size-3.5 text-muted-foreground"
              aria-label="已设提醒"
            />
          ) : null}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          className={styles.menuTrigger}
          aria-label="卡片菜单"
          onClick={function (event) {
            event.stopPropagation()
          }}>
          <Icon
            icon="lucide:more-horizontal"
            className="size-4"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={function () {
              props.onOpen(props.card.id)
            }}>
            <Icon
              icon="lucide:panel-right"
              className="size-4"
            />
            打开详情
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={function () {
              props.onArchive(props.card.id)
            }}>
            <Icon
              icon="lucide:archive"
              className="size-4"
            />
            归档
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

export { CardItem }
