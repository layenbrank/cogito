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
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Icon } from '@iconify/react/offline'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { GET_GATEWAY_PROVIDERS, GET_GATEWAY_USAGE } from '@/apis/gateway.ts'
import { GET_USERS } from '@/apis/user.ts'
import { PageHeader } from '@/components/data-table/page-header.tsx'
import { useConsoleLayoutStore } from '@/stores/console-layout.ts'

const WIDGET_META: Record<string, { title: string; icon: string }> = {
  health: { title: '平台信号', icon: 'lucide:activity' },
  usage: { title: '近期用量', icon: 'lucide:chart-column' },
  providers: { title: '供应商', icon: 'lucide:server' },
  approvals: { title: '运维提示', icon: 'lucide:bell' }
}

interface WidgetCardProps {
  id: string
  children: ReactNode
}

function WidgetCard(props: WidgetCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id
  })
  const meta = WIDGET_META[props.id] ?? { title: props.id, icon: 'lucide:square' }

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1
      }}
      className="rounded-xl border border-border/80 bg-background/80 p-4 shadow-none">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon
            icon={meta.icon}
            className="size-4 text-muted-foreground"
          />
          {meta.title}
        </div>
        <button
          type="button"
          className="cursor-grab rounded p-1 text-muted-foreground"
          aria-label="拖拽小部件"
          {...attributes}
          {...listeners}>
          <Icon
            icon="lucide:grip-vertical"
            className="size-3.5"
          />
        </button>
      </header>
      {props.children}
    </article>
  )
}

export default function OverviewView() {
  const widgets = useConsoleLayoutStore(function (state) {
    return state.dashboardWidgets
  })
  const reorderWidgets = useConsoleLayoutStore(function (state) {
    return state.reorderWidgets
  })

  const users = useQuery({ queryKey: ['users'], queryFn: GET_USERS })
  const providers = useQuery({ queryKey: ['gateway-providers'], queryFn: GET_GATEWAY_PROVIDERS })
  const usage = useQuery({
    queryKey: ['gateway-usage-overview'],
    queryFn: function () {
      return GET_GATEWAY_USAGE({ size: 20 })
    }
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = widgets.indexOf(String(active.id))
    const newIndex = widgets.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    reorderWidgets(arrayMove(widgets, oldIndex, newIndex))
  }

  const totalTokens = (usage.data ?? []).reduce(function (sum, row) {
    return sum + row.totalTokens
  }, 0)

  const content: Record<string, ReactNode> = {
    health: (
      <p className="text-sm text-muted-foreground">
        用户 {users.data?.length ?? '—'} · 供应商{' '}
        {providers.data?.filter(function (item) {
          return item.status === 'ACTIVE'
        }).length ?? '—'}{' '}
        活跃
      </p>
    ),
    usage: (
      <p className="text-2xl font-semibold tracking-tight">
        {usage.isLoading ? '…' : totalTokens.toLocaleString()}
        <span className="ml-2 text-sm font-normal text-muted-foreground">tokens（样本）</span>
      </p>
    ),
    providers: (
      <ul className="space-y-1 text-sm">
        {(providers.data ?? []).slice(0, 5).map(function (item) {
          return (
            <li
              key={item.id}
              className="flex justify-between gap-2">
              <span className="truncate">{item.name}</span>
              <span className="text-muted-foreground">{item.status}</span>
            </li>
          )
        })}
      </ul>
    ),
    approvals: (
      <p className="text-sm text-muted-foreground">
        在 Agent / RAG 页按任务 ID 查询运行态。侧栏可拖拽排序，布局会同步到偏好表。
      </p>
    )
  }

  return (
    <div>
      <PageHeader
        title="概览"
        description="一眼看到平台健康度；小部件可拖拽重排并持久化。"
      />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}>
        <SortableContext
          items={widgets}
          strategy={rectSortingStrategy}>
          <div className="grid gap-4 sm:grid-cols-2">
            {widgets.map(function (id) {
              return (
                <WidgetCard
                  key={id}
                  id={id}>
                  {content[id] ?? null}
                </WidgetCard>
              )
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
