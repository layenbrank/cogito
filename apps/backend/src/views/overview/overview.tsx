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
import { Button } from '@i-thinking/design/components/button'
import { Icon } from '@iconify/react/offline'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { GET_EXCEPTIONS, GET_EXCEPTION_SUMMARY } from '@/apis/exception.ts'
import { GET_GATEWAY_PROVIDERS, GET_GATEWAY_USAGE } from '@/apis/gateway.ts'
import { GET_ADMIN_TENANTS } from '@/apis/tenant.ts'
import { GET_USERS } from '@/apis/user.ts'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { AreaSparkline, BarSparkline } from '@/components/console/sparkline.tsx'
import { useConsoleLayoutStore } from '@/stores/console-layout.ts'

import { OverviewCharts } from './overview-charts.tsx'
import {
  buildDailyActive,
  buildExceptionSeries,
  buildMonthlyActive,
  buildTokenSeries,
  lastPoint,
  sumPoints
} from './metrics.ts'
import { RecentExceptions } from './recent-exceptions.tsx'

const WIDGET_META: Record<string, { title: string; icon: string }> = {
  health: { title: '日活', icon: 'lucide:users' },
  usage: { title: '月活', icon: 'lucide:calendar-range' },
  providers: { title: '异常', icon: 'lucide:triangle-alert' },
  approvals: { title: '快捷入口', icon: 'lucide:zap' }
}

const CHART_HEIGHT = 36

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
        opacity: isDragging ? 0.6 : 1,
        boxShadow: 'var(--backend-elevation-1)'
      }}
      className="rounded-lg border border-border/80 bg-[var(--backend-surface)] p-3">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon
            icon={meta.icon}
            className="size-3.5"
          />
          {meta.title}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 cursor-grab text-muted-foreground"
          aria-label="拖拽小部件"
          {...attributes}
          {...listeners}>
          <Icon
            icon="lucide:grip-vertical"
            className="size-3"
          />
        </Button>
      </header>
      {props.children}
    </article>
  )
}

function MetricBody(props: {
  value: string
  unit: string
  hint: string
  chart: ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold tracking-tight tabular-nums">{props.value}</span>
        <span className="text-[11px] text-muted-foreground">{props.unit}</span>
      </div>
      {props.chart}
      <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">{props.hint}</p>
    </div>
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
  const tenants = useQuery({
    queryKey: ['admin-tenants-overview'],
    queryFn: function () {
      return GET_ADMIN_TENANTS({ size: 200 })
    }
  })
  const usage = useQuery({
    queryKey: ['gateway-usage-overview'],
    queryFn: function () {
      return GET_GATEWAY_USAGE({ size: 200 })
    }
  })
  const exceptionSummary = useQuery({
    queryKey: ['exception-summary-overview'],
    queryFn: function () {
      return GET_EXCEPTION_SUMMARY()
    }
  })
  const exceptions = useQuery({
    queryKey: ['exceptions-overview'],
    queryFn: function () {
      return GET_EXCEPTIONS({ take: 100, skip: 0 })
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

  const usageItems = usage.data?.items ?? []
  const exceptionItems = exceptions.data?.items ?? []
  const dailyPoints = buildDailyActive(usageItems)
  const monthlyPoints = buildMonthlyActive(usageItems)
  const exceptionPoints = buildExceptionSeries(exceptionItems)
  const tokenTotal = sumPoints(buildTokenSeries(usageItems))
  const dailyValue = lastPoint(dailyPoints)
  const monthlyValue = lastPoint(monthlyPoints)
  const exceptionTotal = exceptionSummary.data?.total ?? sumPoints(exceptionPoints)
  const errorCount =
    (exceptionSummary.data?.byLevel?.error ?? 0) + (exceptionSummary.data?.byLevel?.fatal ?? 0)
  const isUsageLoading = usage.isLoading
  const isExceptionLoading = exceptions.isLoading || exceptionSummary.isLoading

  const content: Record<string, ReactNode> = {
    health: (
      <MetricBody
        value={isUsageLoading ? '…' : dailyValue.toLocaleString()}
        unit="今日"
        hint={`近 14 日 · 账号 ${users.data?.length ?? '—'}`}
        chart={
          <BarSparkline
            points={dailyPoints}
            height={CHART_HEIGHT}
            emptyHint="暂无调用"
          />
        }
      />
    ),
    usage: (
      <div>
        <MetricBody
          value={isUsageLoading ? '…' : monthlyValue.toLocaleString()}
          unit="本月"
          hint={`近窗 tokens ${tokenTotal.toLocaleString()}`}
          chart={
            <AreaSparkline
              points={monthlyPoints}
              height={CHART_HEIGHT}
              emptyHint="暂无调用"
            />
          }
        />
        <Link
          to="/gateway/usage"
          className="mt-1.5 inline-flex text-[11px] text-[var(--backend-accent)] hover:underline">
          查看用量
        </Link>
      </div>
    ),
    providers: (
      <div>
        <MetricBody
          value={isExceptionLoading ? '…' : exceptionTotal.toLocaleString()}
          unit="累计"
          hint={`fatal/error ${errorCount} · 供应商 ${
            providers.data?.filter(function (item) {
              return item.status === 'ACTIVE'
            }).length ?? 0
          }`}
          chart={
            <BarSparkline
              points={exceptionPoints}
              height={CHART_HEIGHT}
              color="var(--destructive)"
              emptyHint="无上报"
            />
          }
        />
        <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
          <Link
            to="/exceptions"
            className="text-[var(--backend-accent)] hover:underline">
            异常台
          </Link>
          <Link
            to="/logs"
            className="text-[var(--backend-accent)] hover:underline">
            操作日志
          </Link>
        </div>
      </div>
    ),
    approvals: (
      <ul className="space-y-1.5 text-xs">
        <li>
          <Link
            to="/logs"
            className="text-[var(--backend-accent)] hover:underline">
            操作日志
          </Link>
        </li>
        <li>
          <Link
            to="/exceptions"
            className="text-[var(--backend-accent)] hover:underline">
            异常台
          </Link>
        </li>
        <li>
          <Link
            to="/billing/reconciliation"
            className="text-[var(--backend-accent)] hover:underline">
            计量对账
          </Link>
        </li>
        <li>
          <Link
            to="/agent"
            className="text-[var(--backend-accent)] hover:underline">
            Agent 探针
          </Link>
        </li>
      </ul>
    )
  }

  return (
    <ConsolePage bare>
      <div className="space-y-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}>
          <SortableContext
            items={widgets}
            strategy={rectSortingStrategy}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

        <OverviewCharts
          usageItems={usageItems}
          exceptionSummary={exceptionSummary.data}
          tenants={tenants.data?.items ?? []}
          isUsageLoading={isUsageLoading}
          isExceptionLoading={isExceptionLoading}
          isTenantLoading={tenants.isLoading}
        />

        <RecentExceptions
          items={exceptionItems}
          isLoading={exceptions.isLoading}
          total={exceptions.data?.total ?? exceptionSummary.data?.total}
        />
      </div>
    </ConsolePage>
  )
}
