import { BarChart, LineChart } from '@cogito/design/components/charts'
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { useMemo, type ReactNode } from 'react'

import type { CorexRun } from '@/stores/corex'
import {
  formatElapsed,
  formatRelativeTime,
  RUN_STATUS_STYLES
} from '@/views/directive/run/run-status'
import { useNow } from '@/views/directive/use-now.ts'

import type { LibraryMetrics } from './metrics.ts'
import {
  formatBytes,
  formatFrequency,
  useHostMetrics,
  type HostSnapshot
} from './use-host-metrics.ts'

const MEMORY_BAR_HEIGHT = 88
const MEMORY_TREND_HEIGHT = 96

interface LibraryInsightsProps {
  metrics: LibraryMetrics
  onOpen: (name: string) => void
  onFocusRun?: (id: string) => void
}

function InsightSurface(props: {
  title: string
  icon: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-xs">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Icon
            icon={props.icon}
            className="size-3.5 text-muted-foreground"
          />
          {props.title}
        </div>
        {props.hint ? (
          <span className="max-w-[55%] truncate text-[10px] text-muted-foreground">
            {props.hint}
          </span>
        ) : null}
      </header>
      {props.children}
    </section>
  )
}

function StatusRow(props: { label: string; value: string }) {
  return (
    <li className="flex min-w-0 items-baseline justify-between gap-2 text-[11px]">
      <span className="shrink-0 text-muted-foreground">{props.label}</span>
      <span className="min-w-0 truncate text-right font-medium tabular-nums text-foreground">
        {props.value}
      </span>
    </li>
  )
}

function RunningRow(props: {
  run: CorexRun
  now: number
  onOpen: (name: string) => void
  onFocusRun?: (id: string) => void
}) {
  const style = RUN_STATUS_STYLES.running
  return (
    <li className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
      <span
        className={`size-1.5 shrink-0 rounded-full ${style.dot}`}
        aria-hidden
      />
      <Button
        variant="link"
        type="button"
        className="min-w-0 flex-1 truncate text-left text-xs font-medium hover:underline"
        onClick={function () {
          props.onOpen(props.run.name)
        }}>
        {props.run.name}
      </Button>
      <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
        {formatElapsed(props.run, props.now)}
      </span>
      {props.onFocusRun ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 shrink-0"
          aria-label="查看输出"
          title="查看输出"
          onClick={function () {
            props.onFocusRun?.(props.run.id)
          }}>
          <Icon
            icon="lucide:terminal"
            className="size-3.5"
          />
        </Button>
      ) : null}
    </li>
  )
}

function RunningBlock(props: {
  runs: CorexRun[]
  now: number
  onOpen: (name: string) => void
  onFocusRun?: (id: string) => void
}) {
  const hasRunning = props.runs.length > 0
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-xs">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Icon
            icon="lucide:loader-circle"
            className={`size-3.5 ${hasRunning ? 'animate-spin text-primary' : 'text-muted-foreground'}`}
          />
          正在运行
        </div>
        <span className="text-[10px] text-muted-foreground">
          {hasRunning ? `${props.runs.length} 个任务` : '本会话'}
        </span>
      </header>
      {hasRunning ? (
        <ul className="grid max-h-40 gap-1.5 overflow-y-auto">
          {props.runs.map(function (run) {
            return (
              <RunningRow
                key={run.id}
                run={run}
                now={props.now}
                onOpen={props.onOpen}
                onFocusRun={props.onFocusRun}
              />
            )
          })}
        </ul>
      ) : (
        <p className="py-2 text-[11px] text-muted-foreground">当前没有运行中的指令</p>
      )}
    </section>
  )
}

function MemoryBlock(props: {
  snapshot: HostSnapshot | null
  bars: { name: string; value: number }[]
  trend: { label: string; value: number }[]
  isReady: boolean
  error: string | null
  pollMs: number
}) {
  const { snapshot } = props
  const hint = snapshot
    ? `${formatBytes(snapshot.memoryUsed)} / ${formatBytes(snapshot.memoryTotal)}`
    : props.error
      ? '不可用'
      : '采样中…'
  const emptyHint = props.error
    ? `无法读取（${props.error}）`
    : props.isReady
      ? '等待首次采样…'
      : '采样中…'

  return (
    <InsightSurface
      title="内存资源"
      icon="lucide:memory-stick"
      hint={hint}>
      {/* 数据：system:os.memory / swap 的 used·total；趋势为已用字节换算 MB */}
      {snapshot ? (
        <ul className="mb-2 grid gap-1">
          <StatusRow
            label="已用"
            value={formatBytes(snapshot.memoryUsed)}
          />
          <StatusRow
            label="总量"
            value={formatBytes(snapshot.memoryTotal)}
          />
          <StatusRow
            label="可用"
            value={formatBytes(Math.max(0, snapshot.memoryTotal - snapshot.memoryUsed))}
          />
          {snapshot.swapTotal > 0 ? (
            <StatusRow
              label="交换"
              value={`${formatBytes(snapshot.swapUsed)} / ${formatBytes(snapshot.swapTotal)}`}
            />
          ) : null}
        </ul>
      ) : null}

      <BarChart
        items={props.bars}
        height={MEMORY_BAR_HEIGHT}
        isEmpty={props.bars.length === 0}
        emptyHint={emptyHint}
      />

      {props.trend.length > 0 ? (
        <div className="mt-2">
          <p className="mb-1 text-[10px] text-muted-foreground">已用趋势 · MB</p>
          <LineChart
            points={props.trend}
            height={MEMORY_TREND_HEIGHT}
            isEmpty={false}
          />
        </div>
      ) : null}

      <p className="mt-1.5 text-[10px] text-muted-foreground">
        system:os · 每 {Math.round(props.pollMs / 1000)}s · {props.trend.length || 0} 次
      </p>
    </InsightSurface>
  )
}

function CpuBlock(props: {
  snapshot: HostSnapshot | null
  isReady: boolean
  error: string | null
  pollMs: number
}) {
  const cpu = props.snapshot?.cpu ?? null
  const hint = cpu ? `${cpu.cores} 核 · ${cpu.arch}` : props.error ? '不可用' : '采样中…'

  return (
    <InsightSurface
      title="CPU 资源"
      icon="lucide:cpu"
      hint={hint}>
      {/* system:os.CPU 仅有规格字段，无占用率 —— 只展示实时规格，不画占用曲线 */}
      {cpu ? (
        <ul className="grid gap-1.5">
          <StatusRow
            label="型号"
            value={cpu.brand}
          />
          <StatusRow
            label="核心"
            value={String(cpu.cores)}
          />
          <StatusRow
            label="频率"
            value={formatFrequency(cpu.frequency)}
          />
          <StatusRow
            label="架构"
            value={cpu.arch}
          />
        </ul>
      ) : (
        <p className="py-2 text-[11px] text-muted-foreground">
          {props.error ? `无法读取（${props.error}）` : props.isReady ? '等待首次采样…' : '采样中…'}
        </p>
      )}
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        system:os 规格 · 每 {Math.round(props.pollMs / 1000)}s 刷新
      </p>
    </InsightSurface>
  )
}

function LibraryInsights(props: LibraryInsightsProps) {
  // 运行中任务：store 事件驱动 + 每秒刷新已用时长
  const now = useNow(1_000, true)
  const { metrics } = props
  const host = useHostMetrics()

  const summaryBits = useMemo(
    function () {
      return [
        `${metrics.totals.directives} 条指令`,
        metrics.totals.running > 0 ? `${metrics.totals.running} 运行中` : null,
        metrics.totals.ok > 0 ? `${metrics.totals.ok} 成功` : null,
        metrics.totals.failed > 0 ? `${metrics.totals.failed} 失败` : null
      ].filter(Boolean)
    },
    [metrics.totals]
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 border-b border-border/60 pb-2.5">
        <h2 className="text-sm font-semibold tracking-tight">运行洞察</h2>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {summaryBits.join(' · ')}
        </p>
      </div>

      <RunningBlock
        runs={metrics.running}
        now={now}
        onOpen={props.onOpen}
        onFocusRun={props.onFocusRun}
      />

      <MemoryBlock
        snapshot={host.snapshot}
        bars={host.memoryBars}
        trend={host.memoryUsedTrend}
        isReady={host.isReady}
        error={host.error}
        pollMs={host.pollMs}
      />

      <CpuBlock
        snapshot={host.snapshot}
        isReady={host.isReady}
        error={host.error}
        pollMs={host.pollMs}
      />

      {metrics.running[0] ? (
        <p className="pb-1 text-[10px] text-muted-foreground">
          最近启动：{metrics.running[0].name} ·{' '}
          {formatRelativeTime(metrics.running[0].startedAt, now)}
        </p>
      ) : null}
    </div>
  )
}

export { LibraryInsights }
