import { Button } from '@cogito/design/components/button'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import type { CSSProperties, KeyboardEvent } from 'react'

import type {
  SignboardEntry,
  SignboardCheck,
  SignboardTag
} from '@/stores/signboard'
import { CardQuickSurface } from '@/views/signboard/card-quick-surface'
import { CardItemHead } from '@/views/signboard/card-item-head.tsx'
import { CardItemMeta } from '@/views/signboard/card-item-meta.tsx'
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

function CardItem(props: CardItemProps) {
  const disabled = props.dragDisabled === true

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

  const showNotes = props.card.notes.trim().length > 0
  const checklist = findChecklistProgress(props.checklist)

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
        <Button
          type="button"
          variant="ghost"
          className={styles.cardCover}
          aria-label={`打开「${props.card.title}」`}
          onClick={function () {
            props.onOpen(props.card.id)
          }}>
          <img
            src={props.coverSrc}
            alt=""
            draggable={false}
          />
        </Button>
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
          role="button"
          tabIndex={0}
          className={styles.cardBody}
          aria-label={`打开「${props.card.title}」`}
          onClick={function () {
            props.onOpen(props.card.id)
          }}
          onKeyDown={function (event) {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            props.onOpen(props.card.id)
          }}>
          <CardItemHead
            cardID={props.card.id}
            tags={props.tags}
            onOpen={function () {
              props.onOpen(props.card.id)
            }}
            onArchive={function () {
              props.onArchive(props.card.id)
            }}
          />

          <p className={styles.cardTitle}>{props.card.title}</p>

          <CardItemMeta
            card={props.card}
            attachmentCount={props.attachmentCount}
            showNotes={showNotes}>
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
            <CardQuickSurface
              card={props.card}
              checklist={props.checklist}
              focus="tags"
            />
          </CardItemMeta>
        </div>
      </div>
    </li>
  )
}

export { CardItem }
