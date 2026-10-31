import {
  DndContext,
  DragOverlay,
  MeasuringStrategy
} from '@dnd-kit/core'
import {
  horizontalListSortingStrategy,
  SortableContext
} from '@dnd-kit/sortable'
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { clsx } from 'clsx'

import { ColumnLane } from '@/views/signboard/column-lane'
import {
  CardDragPreview,
  ColumnDragPreview
} from '@/views/signboard/drag-preview'
import styles from '@/views/signboard/signboard.module.scss'
import type { useKanbanBoard } from '@/views/signboard/views/use-kanban-board.ts'

type KanbanBoardSurfaceProps = ReturnType<typeof useKanbanBoard>

function KanbanBoardSurface(vm: KanbanBoardSurfaceProps) {
  const props = vm.viewProps

  return (
    <DndContext
      sensors={vm.sensors}
      collisionDetection={vm.collisionDetection}
      measuring={{
        droppable: { strategy: MeasuringStrategy.Always }
      }}
      onDragStart={vm.onDragStart}
      onDragOver={vm.onDragOver}
      onDragEnd={vm.onDragEnd}
      onDragCancel={vm.onDragCancel}>
      <div
        className={clsx(
          styles.board,
          vm.dragKind === 'card' && styles.boardDraggingCard,
          vm.dragKind === 'column-sort' && styles.boardDraggingColumn
        )}>
        {props.columns.length === 0 ? (
          <div className={styles.emptyBoard}>
            <div className={styles.emptyIcon}>
              <Icon
                icon="lucide:kanban"
                className="size-6"
              />
            </div>
            <p className={styles.emptyTitle}>还没有列</p>
            <p className={styles.emptyDesc}>
              先建一列工作流状态，再把事情放进去。默认可用「待办 / 进行中 / 完成」。
            </p>
            <Button
              type="button"
              size="lg"
              className="mt-1 px-4"
              onClick={function () {
                props.onAddingColumnChange(true)
              }}>
              添加第一列
            </Button>
          </div>
        ) : (
          <SortableContext
            items={vm.columnIDs}
            strategy={horizontalListSortingStrategy}>
            {props.columns.map(function (column, columnIndex) {
              return (
                <ColumnLane
                  key={column.id}
                  column={column}
                  columnIndex={columnIndex}
                  canMoveLeft={columnIndex > 0}
                  canMoveRight={columnIndex < props.columns.length - 1}
                  onMoveColumn={vm.moveColumnByMenu}
                  entries={vm.entriesInColumn(column.id)}
                  tagsByCard={props.tagsByCard}
                  checksForEntry={vm.checksForEntry}
                  coverSrcByCard={vm.coverSrcByCard}
                  attachmentCountByCard={vm.attachmentCountByCard}
                  dragKind={vm.dragKind}
                  isDimmedCard={props.isDimmedCard}
                  selectedCardID={props.selectedCardID}
                  semantic={vm.parseSemantic(column)}
                  requestAdd={props.addRequestColumnID === column.id}
                  onConsumedAddRequest={props.onConsumedAddRequest}
                  onOpenCard={props.onOpenCard}
                  onFocusCard={props.onFocusCard}
                  onKeyMove={vm.onKeyMove}
                  onWriteCard={vm.onWriteCard}
                  onRenameColumn={props.onRenameColumn}
                  onArchiveColumn={props.onArchiveColumn}
                  onArchiveCard={props.onArchiveCard}
                />
              )
            })}
          </SortableContext>
        )}

        {props.addingColumn || props.columns.length > 0 ? (
          <div className={styles.addColumn}>
            {props.addingColumn ? (
              <>
                <Input
                  autoFocus
                  value={props.columnDraft}
                  placeholder="列名称，例如：评审中"
                  className="h-9"
                  onChange={function (event) {
                    props.onColumnDraftChange(event.target.value)
                  }}
                  onKeyDown={function (event) {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void props.onCommitColumn()
                    }
                    if (event.key === 'Escape') {
                      props.onAddingColumnChange(false)
                      props.onColumnDraftChange('')
                    }
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="lg"
                    className="flex-1"
                    onClick={function () {
                      void props.onCommitColumn()
                    }}>
                    添加
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    variant="ghost"
                    onClick={function () {
                      props.onAddingColumnChange(false)
                      props.onColumnDraftChange('')
                    }}>
                    取消
                  </Button>
                </div>
              </>
            ) : (
              <Button
                type="button"
                size="lg"
                variant="outline"
                className={styles.addCard}
                onClick={function () {
                  props.onAddingColumnChange(true)
                }}>
                <Icon
                  icon="lucide:plus"
                  className="size-4"
                />
                添加列
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <DragOverlay
        dropAnimation={null}
        adjustScale={false}>
        {vm.dragCard ? (
          <CardDragPreview
            card={vm.dragCard}
            tags={props.tagsByCard.get(vm.dragCard.id) ?? []}
            checklist={vm.checksForEntry(vm.dragCard.id)}
            coverSrc={vm.coverSrcByCard.get(vm.dragCard.id) ?? null}
            attachmentCount={vm.attachmentCountByCard.get(vm.dragCard.id) ?? 0}
            size={vm.overlaySize}
          />
        ) : null}
        {vm.dragColumn ? (
          <ColumnDragPreview
            column={vm.dragColumn}
            semantic={vm.parseSemantic(vm.dragColumn)}
            entries={vm.entriesInColumn(vm.dragColumn.id)}
            tagsByCard={props.tagsByCard}
            checksForEntry={vm.checksForEntry}
            coverSrcByCard={vm.coverSrcByCard}
            attachmentCountByCard={vm.attachmentCountByCard}
            size={vm.overlaySize}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

export { KanbanBoardSurface }
