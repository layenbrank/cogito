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
import { Icon } from '@iconify/react/offline'
import { NavLink } from 'react-router-dom'

import { NAV_ITEMS, type NavItem } from '@/constants/nav.ts'
import { useConsoleLayoutStore } from '@/stores/console-layout.ts'

interface SortableRowProps {
  item: NavItem
  isPinned: boolean
  onTogglePin: (id: string) => void
}

function SortableRow(props: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-1">
      <button
        type="button"
        className="cursor-grab touch-none rounded p-1 text-[var(--backend-rail-muted)] opacity-0 transition group-hover:opacity-100"
        aria-label="拖拽排序"
        {...attributes}
        {...listeners}>
        <Icon
          icon="lucide:grip-vertical"
          className="size-3.5"
        />
      </button>
      <NavLink
        to={props.item.path}
        className={function ({ isActive }) {
          return [
            'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition',
            isActive
              ? 'bg-white/10 text-[var(--backend-rail-fg)]'
              : 'text-[var(--backend-rail-muted)] hover:bg-white/5 hover:text-[var(--backend-rail-fg)]'
          ].join(' ')
        }}>
        <Icon
          icon={props.item.icon}
          className="size-4 shrink-0"
        />
        <span className="truncate">{props.item.label}</span>
      </NavLink>
      <button
        type="button"
        className="rounded p-1 text-[var(--backend-rail-muted)] hover:text-[var(--backend-rail-fg)]"
        aria-label={props.isPinned ? '取消钉选' : '钉选'}
        onClick={function () {
          props.onTogglePin(props.item.id)
        }}>
        <Icon
          icon={props.isPinned ? 'lucide:pin' : 'lucide:pin-off'}
          className="size-3.5"
        />
      </button>
    </div>
  )
}

function SortableNav() {
  const navOrder = useConsoleLayoutStore(function (state) {
    return state.navOrder
  })
  const pinnedNav = useConsoleLayoutStore(function (state) {
    return state.pinnedNav
  })
  const reorderNav = useConsoleLayoutStore(function (state) {
    return state.reorderNav
  })
  const togglePin = useConsoleLayoutStore(function (state) {
    return state.togglePin
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
  const rows = [...ordered, ...missing]

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = rows.map(function (item) {
      return item.id
    })
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    reorderNav(arrayMove(ids, oldIndex, newIndex))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}>
      <SortableContext
        items={rows.map(function (item) {
          return item.id
        })}
        strategy={verticalListSortingStrategy}>
        <nav className="flex flex-col gap-0.5 px-2">
          {rows.map(function (item) {
            return (
              <SortableRow
                key={item.id}
                item={item}
                isPinned={pinnedNav.includes(item.id)}
                onTogglePin={togglePin}
              />
            )
          })}
        </nav>
      </SortableContext>
    </DndContext>
  )
}

export { SortableNav }
