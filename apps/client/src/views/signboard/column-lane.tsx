import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import { Input } from '@cogito/design/components/input'
import { clsx } from 'clsx'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from 'react'
import { toast } from 'sonner'

import {
  COLUMN_COLORS,
  useSignboardStore,
  type SignboardEntry,
  type SignboardCheck,
  type SignboardColumn,
  type SignboardTag,
  type ColumnRole
} from '@/stores/signboard'
import { CardItem } from '@/views/signboard/card-item'
import { columnDropID, type DragKind } from '@/views/signboard/dnd'
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

  const toUpdateColumn = useSignboardStore(function (state) {
    return state.toUpdateColumn
  })
  const [isAdding, setIsAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { requestAdd, onConsumedAddRequest } = props

  if (requestAdd && !isAdding) {
    setIsAdding(true)
  }

  async function updateRole(role: ColumnRole | null) {
    const ok = await toUpdateColumn(props.column.id, { role })
    if (!ok) toast.error('列语义更新失败')
  }

  async function updateColor(color: string | null) {
    // serde Option<Option>：JSON null 表示「不更新」；清空用空串，后端再写成 None
    const ok = await toUpdateColumn(props.column.id, {
      color: color ?? ''
    })
    if (!ok) toast.error(color ? '设置列颜色失败' : '移除列颜色失败')
  }

  // Trello：色板色直接铺满整列，列头透明继承，不做实心头/淡底双色
  const tint = props.column.color || null
  const columnTone: CSSProperties | undefined = tint
    ? { background: tint }
    : undefined

  useEffect(
    function () {
      if (!requestAdd) return
      onConsumedAddRequest?.()
      requestAnimationFrame(function () {
        inputRef.current?.focus()
      })
    },
    [requestAdd, onConsumedAddRequest]
  )

  async function commit() {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await props.onWriteCard(props.column.id, title)
    setIsAdding(true)
    requestAnimationFrame(function () {
      inputRef.current?.focus()
    })
  }

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
          <Button
            type="button"
            variant="ghost"
            className={styles.columnHandle}
            aria-label="拖拽调整列顺序"
            {...attributes}
            {...listeners}>
            <Icon
              icon="lucide:grip-vertical"
              className="size-3.5"
            />
          </Button>
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
                    const isActive = tint === swatch
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
                          void updateColor(swatch)
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
                {tint ? (
                  <DropdownMenuItem
                    onClick={function () {
                      void updateColor(null)
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
                  void updateRole('todo')
                }}>
                <Icon
                  icon="lucide:circle"
                  className="size-4"
                />
                设为待办
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={function () {
                  void updateRole('doing')
                }}>
                <Icon
                  icon="lucide:circle-dot"
                  className="size-4"
                />
                设为进行中
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={function () {
                  void updateRole('done')
                }}>
                <Icon
                  icon="lucide:check"
                  className="size-4"
                />
                设为完成
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={function () {
                  setIsAdding(true)
                  requestAnimationFrame(function () {
                    inputRef.current?.focus()
                  })
                }}>
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
        </header>

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

        <div className={styles.columnFooter}>
          {isAdding ? (
            <Input
              ref={inputRef}
              autoFocus
              value={draft}
              placeholder="卡片标题，Enter 添加"
              className="h-9"
              onChange={function (event) {
                setDraft(event.target.value)
              }}
              onKeyDown={function (event) {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void commit()
                }
                if (event.key === 'Escape') {
                  setIsAdding(false)
                  setDraft('')
                }
              }}
              onBlur={function () {
                if (!draft.trim()) setIsAdding(false)
              }}
            />
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={styles.addCard}
              onClick={function () {
                setIsAdding(true)
              }}>
              <Icon
                icon="lucide:plus"
                className="size-4"
              />
              添加一张卡片
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}

export { ColumnLane }
