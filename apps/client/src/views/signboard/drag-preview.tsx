import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'

import type {
  SignboardCheck,
  SignboardColumn,
  SignboardEntry,
  SignboardTag
} from '@/stores/signboard'
import { findChecklistProgress } from '@/views/signboard/progress'
import styles from '@/views/signboard/signboard.module.scss'

interface OverlaySize {
  width: number
  height: number
}

interface CardDragPreviewProps {
  card: SignboardEntry
  tags: SignboardTag[]
  checklist: SignboardCheck[]
  coverSrc: string | null
  attachmentCount: number
  size?: OverlaySize | null
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

/** Overlay 用：与 CardItem 同款视觉，无拖拽 hooks */
function CardDragPreview(props: CardDragPreviewProps) {
  const tone = dueTone(props.card.dueAt)
  const visibleTags = props.tags.slice(0, 5)
  const checklist = findChecklistProgress(props.checklist)
  const size = props.size
  const showNotes = props.card.notes.trim().length > 0
  const showDue =
    props.card.dueAt !== null && props.card.dueAt !== undefined
  const hasMeta =
    showNotes ||
    showDue ||
    checklist.total > 0 ||
    props.attachmentCount > 0

  return (
    <div
      className={clsx(styles.card, styles.dragPreview)}
      style={{
        width: size?.width ?? 260,
        height: size?.height,
        overflow: 'hidden'
      }}>
      {props.coverSrc ? (
        <div className={styles.cardCover}>
          <img
            src={props.coverSrc}
            alt=""
            draggable={false}
          />
        </div>
      ) : null}

      <div className={styles.cardMain}>
        <span
          className={styles.handle}
          aria-hidden>
          <Icon
            icon="lucide:grip-vertical"
            className="size-3.5"
          />
        </span>

        <div className={styles.cardBody}>
          {visibleTags.length > 0 ? (
            <div className={styles.cardHead}>
              <div className={styles.cardLabelRow}>
                {visibleTags.map(function (tag) {
                  return (
                    <span
                      key={tag.id}
                      className={styles.cardLabel}
                      style={{
                        background: tag.color ?? 'var(--muted-foreground)'
                      }}>
                      <span className={styles.cardLabelText}>{tag.title}</span>
                    </span>
                  )
                })}
              </div>
            </div>
          ) : null}

          <p className={styles.cardTitle}>{props.card.title}</p>

          {hasMeta ? (
            <div className={styles.cardMeta}>
              {showNotes ? (
                <span className={styles.metaBadge}>
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
                <span className={styles.metaBadge}>
                  <Icon
                    icon="lucide:square-check-big"
                    className="size-3.5"
                    aria-hidden
                  />
                  {checklist.done}/{checklist.total}
                </span>
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
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

interface ColumnDragPreviewProps {
  column: SignboardColumn
  semantic: 'todo' | 'doing' | 'done' | 'other'
  entries: SignboardEntry[]
  tagsByCard: Map<string, SignboardTag[]>
  checksForEntry: (entryID: string) => SignboardCheck[]
  coverSrcByCard: Map<string, string>
  attachmentCountByCard: Map<string, number>
  size?: OverlaySize | null
}

function ColumnDragPreview(props: ColumnDragPreviewProps) {
  const size = props.size
  const tint = props.column.color || null
  const columnTone = tint ? { background: tint } : undefined

  return (
    <div
      className={clsx(styles.column, styles.dragPreview)}
      style={{
        width: size?.width ?? 272,
        height: size?.height ?? 'auto',
        maxHeight: size?.height,
        overflow: 'hidden',
        ...columnTone
      }}>
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
          <span className={styles.columnCount}>{props.entries.length}</span>
        </h3>
        <span className={styles.columnHandle}>
          <Icon
            icon="lucide:grip-vertical"
            className="size-3.5"
          />
        </span>
      </header>
      <ul className={styles.cards}>
        {props.entries.slice(0, 6).map(function (card) {
          return (
            <CardDragPreview
              key={card.id}
              card={card}
              tags={props.tagsByCard.get(card.id) ?? []}
              checklist={props.checksForEntry(card.id)}
              coverSrc={props.coverSrcByCard.get(card.id) ?? null}
              attachmentCount={props.attachmentCountByCard.get(card.id) ?? 0}
            />
          )
        })}
      </ul>
      <div className={styles.columnFooter}>
        <span className={styles.dragPreviewFooterHint}>
          <Icon
            icon="lucide:plus"
            className="size-4"
          />
          添加一张卡片
        </span>
      </div>
    </div>
  )
}

export { CardDragPreview, ColumnDragPreview }
export type { OverlaySize }
