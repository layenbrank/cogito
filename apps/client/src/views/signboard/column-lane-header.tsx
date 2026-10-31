import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'

import type { SignboardColumn } from '@/stores/signboard'
import { ColumnLaneMenu } from '@/views/signboard/column-lane-menu.tsx'
import styles from '@/views/signboard/signboard.module.scss'

interface ColumnLaneHeaderProps {
  column: SignboardColumn
  entryCount: number
  semantic: 'todo' | 'doing' | 'done' | 'other'
  tint: string | null
  canMoveLeft: boolean
  canMoveRight: boolean
  columnIndex: number
  sortHandleProps: Record<string, unknown>
  onRenameColumn: (column: SignboardColumn) => void
  onMoveColumn: (columnID: string, toIndex: number) => void
  onUpdateRole: (role: 'todo' | 'doing' | 'done' | null) => void
  onUpdateColor: (color: string | null) => void
  onArchiveColumn: (columnID: string) => void
  onStartAddCard: () => void
}

function ColumnLaneHeader(props: ColumnLaneHeaderProps) {
  return (
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
        <span className={styles.columnCount}>{props.entryCount}</span>
      </h3>
      <Button
        type="button"
        variant="ghost"
        className={styles.columnHandle}
        aria-label="拖拽调整列顺序"
        {...props.sortHandleProps}>
        <Icon
          icon="lucide:grip-vertical"
          className="size-3.5"
        />
      </Button>
      <ColumnLaneMenu
        column={props.column}
        tint={props.tint}
        canMoveLeft={props.canMoveLeft}
        canMoveRight={props.canMoveRight}
        columnIndex={props.columnIndex}
        onRenameColumn={props.onRenameColumn}
        onMoveColumn={props.onMoveColumn}
        onUpdateRole={props.onUpdateRole}
        onUpdateColor={props.onUpdateColor}
        onArchiveColumn={props.onArchiveColumn}
        onStartAddCard={props.onStartAddCard}
      />
    </header>
  )
}

export { ColumnLaneHeader }
