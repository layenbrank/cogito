import { Icon } from '@iconify/react/offline'
import type { ReactNode } from 'react'

import type { ExceptionSummary } from '@/apis/exception.ts'
import type { UsageRecord } from '@/apis/gateway.ts'
import type { TenantSummary } from '@/apis/tenant.ts'
import { BarChart, LineChart, PieChart } from '@cogito/design/components/charts'

import {
  buildExceptionLevelCounts,
  buildModelRequestCounts,
  buildTenantStatusCounts,
  buildTokenSeries
} from './metrics.ts'

const PANEL_HEIGHT = 260

interface OverviewChartsProps {
  usageItems: UsageRecord[]
  exceptionSummary: ExceptionSummary | undefined
  tenants: TenantSummary[]
  isUsageLoading: boolean
  isExceptionLoading: boolean
  isTenantLoading: boolean
}

interface ChartPanelProps {
  title: string
  icon: string
  hint?: string
  children: ReactNode
}

function ChartPanel(props: ChartPanelProps) {
  return (
    <section
      className="rounded-lg border border-border/80 bg-[var(--backend-surface)] p-3"
      style={{ boxShadow: 'var(--backend-elevation-1)' }}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Icon
            icon={props.icon}
            className="size-3.5 text-muted-foreground"
          />
          {props.title}
        </div>
        {props.hint ? (
          <span className="text-[10px] text-muted-foreground">{props.hint}</span>
        ) : null}
      </header>
      {props.children}
    </section>
  )
}

function OverviewCharts(props: OverviewChartsProps) {
  const tokenPoints = buildTokenSeries(props.usageItems)
  const modelCounts = buildModelRequestCounts(props.usageItems)
  const levelCounts = buildExceptionLevelCounts(props.exceptionSummary)
  const tenantStatusCounts = buildTenantStatusCounts(props.tenants)

  const hasTokenData = tokenPoints.some(function (point) {
    return point.value > 0
  })
  const isTokenEmpty = !props.isUsageLoading && !hasTokenData
  const isModelEmpty = !props.isUsageLoading && modelCounts.length === 0
  const isLevelEmpty = !props.isExceptionLoading && levelCounts.length === 0
  const isTenantEmpty = !props.isTenantLoading && tenantStatusCounts.length === 0

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartPanel
        title="Token 用量趋势"
        icon="lucide:activity"
        hint="近 14 日 · 网关用量">
        <LineChart
          points={tokenPoints}
          height={PANEL_HEIGHT}
          isEmpty={isTokenEmpty}
          emptyHint={props.isUsageLoading ? '加载中…' : '暂无调用记录'}
        />
      </ChartPanel>

      <ChartPanel
        title="模型请求分布"
        icon="lucide:boxes"
        hint="近窗 Top 模型">
        <BarChart
          items={modelCounts}
          height={PANEL_HEIGHT}
          isEmpty={isModelEmpty}
          emptyHint={props.isUsageLoading ? '加载中…' : '暂无请求'}
        />
      </ChartPanel>

      <ChartPanel
        title="异常级别分布"
        icon="lucide:pie-chart"
        hint="异常摘要">
        <PieChart
          items={levelCounts}
          height={PANEL_HEIGHT}
          isEmpty={isLevelEmpty}
          emptyHint={props.isExceptionLoading ? '加载中…' : '无异常上报'}
        />
      </ChartPanel>

      <ChartPanel
        title="租户状态分布"
        icon="lucide:building-2"
        hint="平台租户快照">
        <PieChart
          items={tenantStatusCounts}
          height={PANEL_HEIGHT}
          isEmpty={isTenantEmpty}
          emptyHint={props.isTenantLoading ? '加载中…' : '暂无租户'}
        />
      </ChartPanel>
    </div>
  )
}

export { OverviewCharts }
