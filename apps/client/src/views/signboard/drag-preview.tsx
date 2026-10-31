import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'

import type {
  SignboardCheck,
  SignboardColumn,
  SignboardEntry,
  SignboardTag
} from '@/stores/signboard'
import { CardDragPreviewBody } from '@/views/signboard/card-drag-preview-body.tsx'
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

/** Overlay 用：与 CardItem 同款视觉，无拖拽 hooks */
function CardDragPreview(props: CardDragPreviewProps) {
  const size = props.size

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
          <CardDragPreviewBody
            card={props.card}
            tags={props.tags}
            checklist={props.checklist}
            attachmentCount={props.attachmentCount}
          />
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
