import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { clsx } from 'clsx'
import { useMemo, type CSSProperties, type KeyboardEvent } from 'react'

import type {
  SignboardEntry,
  SignboardCheck,
  SignboardColumn,
  SignboardTag
} from '@/stores/signboard'
import { CardItem } from '@/views/signboard/card-item'
import { ColumnLaneFooter } from '@/views/signboard/column-lane-footer.tsx'
import { ColumnLaneHeader } from '@/views/signboard/column-lane-header.tsx'
import { columnDropID, type DragKind } from '@/views/signboard/dnd'
import { useColumnLaneState } from '@/views/signboard/use-column-lane-state.ts'
import styles from '@/views/signboard/signboard.module.scss'

interface ColumnLaneProps {
  column: SignboardColumn
  entries: SignboardEntry[]
  tagsByCard: Map<string, SignboardTag[]>
  checksForEntry: (entryID: string) => SignboardCheck[]
  coverSrcByCard: Map<string, string>
  attachmentCountByCard: Map<string, number>
  dragKind: DragKind | null
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
  canMoveLeft: boolean
  canMoveRight: boolean
  onMoveColumn: (columnID: string, toIndex: number) => void
  columnIndex: number
}

function ColumnLane(props: ColumnLaneProps) {
  const isColumnDrag = props.dragKind === 'column-sort'
  const isCardDrag = props.dragKind === 'card'

  const lane = useColumnLaneState({
    columnID: props.column.id,
    requestAdd: props.requestAdd,
    onConsumedAddRequest: props.onConsumedAddRequest,
    onWriteCard: props.onWriteCard
  })

  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: props.column.id,
    data: { type: 'column-sort', columnID: props.column.id },
    disabled: isCardDrag
  })

  const { setNodeRef: setCardDropRef, isOver: isCardOver } = useDroppable({
    id: columnDropID(props.column.id),
    data: { type: 'column-drop', columnID: props.column.id },
    disabled: isColumnDrag
  })

  const tint = props.column.color || null
  const columnTone: CSSProperties | undefined = tint ? { background: tint } : undefined

  const columnStyle: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition
  }

  const cardIDs = useMemo(
    function () {
      return props.entries.map(function (card) {
        return card.id
      })
    },
    [props.entries]
  )

  return (
    <div
      ref={setSortableRef}
      className={styles.columnSlot}
      style={columnStyle}>
      <section
        className={clsx(
          styles.column,
          isDragging && styles.dragSource,
          isCardOver && isCardDrag && styles.columnOver
        )}
        style={columnTone}>
        <ColumnLaneHeader
          column={props.column}
          entryCount={props.entries.length}
          semantic={props.semantic}
          tint={tint}
          canMoveLeft={props.canMoveLeft}
          canMoveRight={props.canMoveRight}
          columnIndex={props.columnIndex}
          sortHandleProps={{ ...attributes, ...listeners }}
          onRenameColumn={props.onRenameColumn}
          onMoveColumn={props.onMoveColumn}
          onUpdateRole={function (role) {
            void lane.updateRole(role)
          }}
          onUpdateColor={function (color) {
            void lane.updateColor(color)
          }}
          onArchiveColumn={props.onArchiveColumn}
          onStartAddCard={lane.startAddCard}
        />

        <SortableContext
          items={cardIDs}
          strategy={verticalListSortingStrategy}>
          <ul
            ref={setCardDropRef}
            className={clsx(
              styles.cards,
              isCardOver && isCardDrag && styles.columnOver
            )}>
            {props.entries.map(function (card) {
              return (
                <CardItem
                  key={card.id}
                  card={card}
                  tags={props.tagsByCard.get(card.id) ?? []}
                  checklist={props.checksForEntry(card.id)}
                  coverSrc={props.coverSrcByCard.get(card.id) ?? null}
                  attachmentCount={props.attachmentCountByCard.get(card.id) ?? 0}
                  dragDisabled={isColumnDrag}
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

        <ColumnLaneFooter
          isAdding={lane.isAdding}
          draft={lane.draft}
          inputRef={lane.inputRef}
          onDraftChange={lane.setDraft}
          onCommit={function () {
            void lane.commit()
          }}
          onCancelAdd={lane.cancelAdd}
          onStartAdd={function () {
            lane.setIsAdding(true)
          }}
        />
      </section>
    </div>
  )
}

export { ColumnLane }
