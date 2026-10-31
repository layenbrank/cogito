import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'

import type { SignboardEntry } from '@/stores/signboard'
import { dueTone, formatDue } from '@/views/signboard/card-due.ts'
import styles from '@/views/signboard/signboard.module.scss'

interface CardItemMetaProps {
  card: SignboardEntry
  attachmentCount: number
  showNotes: boolean
  children?: ReactNode
}

function CardItemMeta(props: CardItemMetaProps) {
  const tone = dueTone(props.card.dueAt)
  const showDue =
    props.card.dueAt !== null && props.card.dueAt !== undefined
  const hasMeta =
    props.showNotes ||
    showDue ||
    props.attachmentCount > 0 ||
    props.card.priority > 0 ||
    Boolean(props.card.reminderID) ||
    Boolean(props.children)

  return (
    <div className={hasMeta ? styles.cardMeta : styles.cardMetaEmpty}>
      {props.showNotes ? (
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
      {props.children}
    </div>
  )
}

export { CardItemMeta }
