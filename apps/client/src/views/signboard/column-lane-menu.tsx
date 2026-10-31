import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { clsx } from 'clsx'

import { COLUMN_COLORS, type SignboardColumn, type ColumnRole } from '@/stores/signboard'
import styles from '@/views/signboard/signboard.module.scss'

interface ColumnLaneMenuProps {
  column: SignboardColumn
  tint: string | null
  canMoveLeft: boolean
  canMoveRight: boolean
  columnIndex: number
  onRenameColumn: (column: SignboardColumn) => void
  onMoveColumn: (columnID: string, toIndex: number) => void
  onUpdateRole: (role: ColumnRole | null) => void
  onUpdateColor: (color: string | null) => void
  onArchiveColumn: (columnID: string) => void
  onStartAddCard: () => void
}

function ColumnLaneMenu(props: ColumnLaneMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={styles.menuTrigger}
        aria-label="列菜单">
        <Icon
          icon="lucide:more-horizontal"
          className="size-4"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={styles.columnMenu}>
        <DropdownMenuItem
          onClick={function () {
            props.onRenameColumn(props.column)
          }}>
          <Icon
            icon="lucide:pencil"
            className="size-4"
          />
          重命名
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!props.canMoveLeft}
          onClick={function () {
            props.onMoveColumn(props.column.id, props.columnIndex - 1)
          }}>
          <Icon
            icon="lucide:arrow-left"
            className="size-4"
          />
          左移
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!props.canMoveRight}
          onClick={function () {
            props.onMoveColumn(props.column.id, props.columnIndex + 1)
          }}>
          <Icon
            icon="lucide:arrow-right"
            className="size-4"
          />
          右移
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>列表颜色</DropdownMenuLabel>
          <div
            className={styles.columnColorRow}
            role="listbox"
            aria-label="列表颜色">
            {COLUMN_COLORS.map(function (swatch) {
              const isActive = props.tint === swatch
              return (
                <Button
                  key={swatch}
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={isActive}
                  aria-label={swatch}
                  className={clsx(
                    styles.columnColorSwatch,
                    isActive && styles.columnColorSwatchActive
                  )}
                  style={{ background: swatch }}
                  onClick={function () {
                    props.onUpdateColor(swatch)
                  }}>
                  {isActive ? (
                    <Icon
                      icon="lucide:check"
                      className="size-3.5"
                    />
                  ) : null}
                </Button>
              )
            })}
          </div>
          {props.tint ? (
            <DropdownMenuItem
              onClick={function () {
                props.onUpdateColor(null)
              }}>
              <Icon
                icon="lucide:x"
                className="size-4"
              />
              移除颜色
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={function () {
            props.onUpdateRole('todo')
          }}>
          <Icon
            icon="lucide:circle"
            className="size-4"
          />
          设为待办
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={function () {
            props.onUpdateRole('doing')
          }}>
          <Icon
            icon="lucide:circle-dot"
            className="size-4"
          />
          设为进行中
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={function () {
            props.onUpdateRole('done')
          }}>
          <Icon
            icon="lucide:check"
            className="size-4"
          />
          设为完成
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={props.onStartAddCard}>
          <Icon
            icon="lucide:plus"
            className="size-4"
          />
          添加卡片
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={function () {
            props.onArchiveColumn(props.column.id)
          }}>
          <Icon
            icon="lucide:archive"
            className="size-4"
          />
          归档列
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ColumnLaneMenu }
