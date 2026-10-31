import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'

import type { SignboardCheck, SignboardEntry, SignboardTag } from '@/stores/signboard'
import { dueTone, formatDue } from '@/views/signboard/card-due.ts'
import { findChecklistProgress } from '@/views/signboard/progress'
import styles from '@/views/signboard/signboard.module.scss'

interface CardDragPreviewBodyProps {
  card: SignboardEntry
  tags: SignboardTag[]
  checklist: SignboardCheck[]
  attachmentCount: number
}

function CardDragPreviewBody(props: CardDragPreviewBodyProps) {
  const tone = dueTone(props.card.dueAt)
  const visibleTags = props.tags.slice(0, 5)
  const checklist = findChecklistProgress(props.checklist)
  const showNotes = props.card.notes.trim().length > 0
  const showDue =
    props.card.dueAt !== null && props.card.dueAt !== undefined
  const hasMeta =
    showNotes || showDue || checklist.total > 0 || props.attachmentCount > 0

  return (
    <>
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
    </>
  )
}

export { CardDragPreviewBody }
