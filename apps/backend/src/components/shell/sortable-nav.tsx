import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@cogito/design/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@cogito/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import clsx from 'clsx'
import { type ReactElement } from 'react'
import { NavLink } from 'react-router-dom'

import { NAV_GROUPS, NAV_ITEMS, type NavGroup, type NavItem } from '@/constants/nav.ts'
import { useConsoleLayoutStore } from '@/stores/console-layout.ts'

/** 侧栏菜单字号下限 14px（对齐 antd Menu 默认） */
const RAIL_TEXT = 'text-sm leading-none'
const RAIL_ROW = 'h-10'
const RAIL_ICON = 'size-4'

interface SortableRowProps {
  item: NavItem
  isPinned: boolean
  /** 侧栏已收窄：隐藏文案（与宽度过渡同步，避免等居中后再藏字） */
  isRailNarrow: boolean
  /** 宽度过渡结束后的图标居中模式 */
  isIconMode: boolean
  onTogglePin: (id: string) => void
}

/**
 * 折叠态标签：antd Menu.tooltip / Element popper / Naive collapsed 旁白。
 * 展开态仅在有 hint 时展示说明，避免与可见文案重复。
 */
function NavHintTooltip(props: {
  item: NavItem
  isIconMode: boolean
  children: ReactElement
}) {
  const hint = props.item.hint
  if (!props.isIconMode && !hint) {
    return props.children
  }
  const title = props.isIconMode
    ? hint
      ? `${props.item.label} · ${hint}`
      : props.item.label
    : hint!
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipContent
        side="right"
        sideOffset={10}
        className="max-w-[14rem]">
        {title}
      </TooltipContent>
    </Tooltip>
  )
}

function SortableRow(props: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id,
    disabled: props.isRailNarrow
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1
  }

  if (props.isIconMode) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="flex w-full justify-center py-0.5">
        <NavHintTooltip
          item={props.item}
          isIconMode>
          <NavLink
            to={props.item.path}
            aria-label={props.item.label}
            className={function ({ isActive }) {
              return clsx(
                'relative mx-auto flex items-center justify-center rounded-md transition-colors',
                'size-[var(--backend-rail-icon-hit)]',
                isActive
                  ? 'bg-[var(--backend-accent-soft)] text-[var(--backend-rail-fg)] before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-[var(--backend-accent)]'
                  : 'text-[var(--backend-rail-fg)]/75 hover:bg-[var(--backend-rail-hover)] hover:text-[var(--backend-rail-fg)]'
              )
            }}>
            <Icon
              icon={props.item.icon}
              width="var(--backend-rail-icon-glyph)"
              height="var(--backend-rail-icon-glyph)"
              className="size-[var(--backend-rail-icon-glyph)] shrink-0 opacity-90"
            />
          </NavLink>
        </NavHintTooltip>
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx('group relative flex items-center', RAIL_ROW)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="ml-0.5 size-7 shrink-0 cursor-grab touch-none text-[var(--backend-rail-muted)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--backend-rail-hover)] hover:text-[var(--backend-rail-fg)]"
        aria-label="拖拽排序"
        {...attributes}
        {...listeners}>
        <Icon
          icon="lucide:grip-vertical"
          className="size-3.5"
        />
      </Button>
      <NavHintTooltip
        item={props.item}
        isIconMode={false}>
        <NavLink
          to={props.item.path}
          aria-label={props.item.label}
          className={function ({ isActive }) {
            return clsx(
              'relative flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-2 pr-8 pl-2.5 transition-colors',
              RAIL_ROW,
              RAIL_TEXT,
              isActive
                ? 'bg-[var(--backend-accent-soft)] font-medium text-[var(--backend-rail-fg)] before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-[var(--backend-accent)]'
                : 'font-normal text-[var(--backend-rail-fg)]/75 hover:bg-[var(--backend-rail-hover)] hover:text-[var(--backend-rail-fg)]'
            )
          }}>
          <Icon
            icon={props.item.icon}
            className={clsx(RAIL_ICON, 'shrink-0 opacity-90')}
          />
          <span
            className={clsx(
              'truncate transition-[opacity,max-width] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
              props.isRailNarrow
                ? 'max-w-0 overflow-hidden opacity-0'
                : 'max-w-[11rem] opacity-100'
            )}>
            {props.item.label}
          </span>
        </NavLink>
      </NavHintTooltip>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={clsx(
          'absolute right-1 size-7 text-[var(--backend-rail-muted)] transition-opacity duration-150 hover:bg-[var(--backend-rail-hover)] hover:text-[var(--backend-rail-fg)]',
          props.isPinned
            ? 'opacity-70 group-hover:opacity-100'
            : 'opacity-0 group-hover:opacity-100'
        )}
        aria-label={props.isPinned ? '取消钉选' : '钉选'}
        onClick={function () {
          props.onTogglePin(props.item.id)
        }}>
        <Icon
          icon={props.isPinned ? 'lucide:pin' : 'lucide:pin-off'}
          className="size-3.5"
        />
      </Button>
    </div>
  )
}

interface NavGroupBlockProps {
  group: NavGroup
  items: NavItem[]
  isRailNarrow: boolean
  isIconMode: boolean
  isGroupOpen: boolean
  isGroupIconVisible: boolean
  pinnedNav: string[]
  onTogglePin: (id: string) => void
  onToggleGroup: (group: string) => void
}

/**
 * 对齐 antd Menu.ItemGroup + 可选 SubMenu 开合：
 * 不用 Collapsible 高度动画（侧栏收窄时会重算 panel 高度导致子项闪烁）。
 */
function NavGroupBlock(props: NavGroupBlockProps) {
  const rows = (
    <div className="flex flex-col gap-0.5">
      {props.items.map(function (item) {
        return (
          <SortableRow
            key={item.id}
            item={item}
            isRailNarrow={props.isRailNarrow}
            isIconMode={props.isIconMode}
            isPinned={props.pinnedNav.includes(item.id)}
            onTogglePin={props.onTogglePin}
          />
        )
      })}
    </div>
  )

  return (
    <div className={clsx('relative', props.isIconMode && 'w-full')}>
      {props.isIconMode ? (
        <div
          className="mx-auto my-1.5 h-px w-[var(--backend-rail-icon-glyph)] bg-[var(--backend-rail-border)]"
          aria-hidden
        />
      ) : (
        <button
          type="button"
          className={clsx(
            'mb-1 flex w-full items-center gap-2 rounded-md px-2.5 text-left font-medium text-[var(--backend-rail-muted)] transition hover:bg-[var(--backend-rail-hover)] hover:text-[var(--backend-rail-fg)]',
            RAIL_ROW,
            RAIL_TEXT
          )}
          aria-expanded={props.isGroupOpen}
          onClick={function () {
            props.onToggleGroup(props.group.id)
          }}>
          {props.isGroupIconVisible ? (
            <Icon
              icon={props.group.icon}
              className={clsx(RAIL_ICON, 'shrink-0 opacity-80')}
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{props.group.label}</span>
          <Icon
            icon="lucide:chevron-right"
            className={clsx(
              'size-4 shrink-0 opacity-60 transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
              props.isGroupOpen && 'rotate-90'
            )}
          />
        </button>
      )}
      <div
        className={clsx(
          !props.isIconMode && 'pl-1',
          !props.isIconMode && !props.isGroupOpen && 'hidden'
        )}
        aria-hidden={!props.isIconMode && !props.isGroupOpen}>
        {rows}
      </div>
    </div>
  )
}

interface SortableNavProps {
  /** 侧栏宽度已收窄（与 width 过渡同步） */
  isRailNarrow?: boolean
  /** 宽度过渡结束后的图标居中 */
  isIconMode?: boolean
}

function SortableNav(props: SortableNavProps) {
  const isRailNarrow = props.isRailNarrow ?? false
  const isIconMode = props.isIconMode ?? false
  const navOrder = useConsoleLayoutStore(function (state) {
    return state.navOrder
  })
  const pinnedNav = useConsoleLayoutStore(function (state) {
    return state.pinnedNav
  })
  const collapsedNavGroups = useConsoleLayoutStore(function (state) {
    return state.collapsedNavGroups
  })
  const isNavGroupIconVisible = useConsoleLayoutStore(function (state) {
    return state.isNavGroupIconVisible
  })
  const reorderNav = useConsoleLayoutStore(function (state) {
    return state.reorderNav
  })
  const togglePin = useConsoleLayoutStore(function (state) {
    return state.togglePin
  })
  const toggleNavGroup = useConsoleLayoutStore(function (state) {
    return state.toggleNavGroup
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const byId = new Map(
    NAV_ITEMS.map(function (item) {
      return [item.id, item]
    })
  )

  const ordered = navOrder
    .map(function (id) {
      return byId.get(id)
    })
    .filter(function (item): item is NavItem {
      return Boolean(item)
    })

  const missing = NAV_ITEMS.filter(function (item) {
    return !navOrder.includes(item.id)
  })
  const allRows = [...ordered, ...missing]

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = allRows.map(function (item) {
      return item.id
    })
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    reorderNav(arrayMove(ids, oldIndex, newIndex))
  }

  const grouped = NAV_GROUPS.map(function (group) {
    return {
      group,
      items: allRows.filter(function (item) {
        return item.group === group.id
      })
    }
  }).filter(function (entry) {
    return entry.items.length > 0
  })

  return (
    <TooltipProvider delay={280}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}>
        <SortableContext
          items={allRows.map(function (item) {
            return item.id
          })}
          strategy={verticalListSortingStrategy}>
          <nav
            className={clsx(
              'flex w-full flex-col',
              isIconMode ? 'gap-1 px-0' : 'gap-1.5 px-2'
            )}>
            {grouped.map(function (entry) {
              return (
                <NavGroupBlock
                  key={entry.group.id}
                  group={entry.group}
                  items={entry.items}
                  isRailNarrow={isRailNarrow}
                  isIconMode={isIconMode}
                  isGroupOpen={!collapsedNavGroups.includes(entry.group.id)}
                  isGroupIconVisible={isNavGroupIconVisible}
                  pinnedNav={pinnedNav}
                  onTogglePin={togglePin}
                  onToggleGroup={toggleNavGroup}
                />
              )
            })}
          </nav>
        </SortableContext>
      </DndContext>
    </TooltipProvider>
  )
}

export { SortableNav }
