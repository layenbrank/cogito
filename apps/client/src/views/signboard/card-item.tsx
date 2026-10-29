import { Button } from '@cogito/design/components/button'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Icon } from '@iconify/react/offline'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { clsx } from 'clsx'
import type { CSSProperties, KeyboardEvent } from 'react'
import { toast } from 'sonner'

import {
  useSignboardStore,
  type SignboardEntry,
  type SignboardCheck,
  type SignboardTag
} from '@/stores/signboard'
import { CardQuickSurface } from '@/views/signboard/card-quick-surface'
import { findChecklistProgress } from '@/views/signboard/progress'
import styles from '@/views/signboard/signboard.module.scss'

interface CardItemProps {
  card: SignboardEntry
  tags: SignboardTag[]
  checklist: SignboardCheck[]
  coverSrc: string | null
  attachmentCount: number
  dragDisabled?: boolean
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
  if (dueAt === null || dueAt === undefined) return null
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  if (dueAt < start.getTime()) return 'overdue'
  const end = start.getTime() + 24 * 60 * 60 * 1000
  if (dueAt < end) return 'today'
  return 'later'
}

function hasNotes(notes: string) {
  return notes.trim().length > 0
}

function CardItem(props: CardItemProps) {
  const disabled = props.dragDisabled === true
  const toUntagEntry = useSignboardStore(function (state) {
    return state.toUntagEntry
  })

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: props.card.id,
    data: { type: 'card', columnID: props.card.columnID },
    disabled,
    transition: {
      duration: 220,
      easing: 'cubic-bezier(0.25, 1, 0.5, 1)'
    }
  })

  const tone = dueTone(props.card.dueAt)
  const visibleTags = props.tags.slice(0, 5)
  const hiddenTagCount = Math.max(0, props.tags.length - visibleTags.length)
  const checklist = findChecklistProgress(props.checklist)
  const showNotes = hasNotes(props.card.notes)
  const showDue =
    props.card.dueAt !== null && props.card.dueAt !== undefined
  const hasMeta =
    showNotes ||
    showDue ||
    checklist.total > 0 ||
    props.attachmentCount > 0 ||
    props.card.priority > 0 ||
    Boolean(props.card.reminderID)

  async function removeTag(tagID: string) {
    const ok = await toUntagEntry(props.card.id, tagID)
    if (!ok) toast.error('移除标签失败')
  }

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={clsx(
        styles.card,
        isDragging && styles.dragSource,
        props.isDimmed && !isDragging && styles.cardDimmed,
        props.isSelected && styles.cardSelected
      )}
      tabIndex={0}
      onFocus={function () {
        props.onFocusCard(props.card.id)
      }}
      onKeyDown={function (event) {
        props.onKeyMove(props.card.id, event)
      }}>
      {props.coverSrc ? (
        <div
          className={styles.cardCover}
          onClick={function () {
            props.onOpen(props.card.id)
          }}>
          <img
            src={props.coverSrc}
            alt=""
            draggable={false}
          />
        </div>
      ) : null}

      <div className={styles.cardMain}>
        <Button
          type="button"
          variant="ghost"
          className={styles.handle}
          aria-label="拖拽卡片"
          {...attributes}
          {...listeners}>
          <Icon
            icon="lucide:grip-vertical"
            className="size-3.5"
          />
        </Button>

        <div
          className={styles.cardBody}
          onClick={function () {
            props.onOpen(props.card.id)
          }}>
          <div className={styles.cardHead}>
            <div className={styles.cardLabelRow}>
              {visibleTags.map(function (tag) {
                return (
                  <Button
                    key={tag.id}
                    type="button"
                    variant="ghost"
                    className={styles.cardLabel}
                    title={`移除标签「${tag.title}」`}
                    style={{
                      background: tag.color ?? 'var(--muted-foreground)'
                    }}
                    onClick={function (event) {
                      event.stopPropagation()
                      void removeTag(tag.id)
                    }}
                    onPointerDown={function (event) {
                      event.stopPropagation()
                    }}>
                    <span className={styles.cardLabelText}>{tag.title}</span>
                  </Button>
                )
              })}
              {hiddenTagCount > 0 ? (
                <span className={styles.tagMore}>+{hiddenTagCount}</span>
              ) : null}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={styles.menuTrigger}
                aria-label="卡片菜单"
                onClick={function (event) {
                  event.stopPropagation()
                }}
                onPointerDown={function (event) {
                  event.stopPropagation()
                }}>
                <Icon
                  icon="lucide:more-horizontal"
                  className="size-4"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="bottom"
                align="end"
                sideOffset={4}
                className="min-w-36">
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
          </div>

          <p className={styles.cardTitle}>{props.card.title}</p>

          <div className={hasMeta ? styles.cardMeta : styles.cardMetaEmpty}>
            {showNotes ? (
              <span
                className={styles.metaBadge}
                title="有描述"
                aria-label="有描述">
                <Icon
                  icon="lucide:align-left"
                  className="size-3.5"
                  aria-hidden
                />
              </span>
            ) : null}
            {showDue ? (
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
                {formatDue(props.card.dueAt as number)}
              </span>
            ) : null}
            {checklist.total > 0 ? (
              <CardQuickSurface
                card={props.card}
                checklist={props.checklist}
                focus="checks"
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    className={styles.metaBadge}
                    title="清单"
                    onClick={function (event) {
                      event.stopPropagation()
                    }}
                    onPointerDown={function (event) {
                      event.stopPropagation()
                    }}>
                    <Icon
                      icon="lucide:square-check-big"
                      className="size-3.5"
                      aria-hidden
                    />
                    {checklist.done}/{checklist.total}
                  </Button>
                }
              />
            ) : null}
            {props.attachmentCount > 0 ? (
              <span className={styles.metaBadge}>
                <Icon
                  icon="lucide:paperclip"
                  className="size-3.5"
                  aria-hidden
                />
                {props.attachmentCount}
              </span>
            ) : null}
            {props.card.priority > 0 ? (
              <span className={styles.priorityBadge}>P{props.card.priority}</span>
            ) : null}
            {props.card.reminderID ? (
              <span
                className={styles.metaBadge}
                aria-label="已设提醒">
                <Icon
                  icon="lucide:bell"
                  className="size-3.5"
                  aria-hidden
                />
              </span>
            ) : null}
            <CardQuickSurface
              card={props.card}
              checklist={props.checklist}
              focus="tags"
            />
          </div>
        </div>
      </div>
    </li>
  )
}

export { CardItem }
