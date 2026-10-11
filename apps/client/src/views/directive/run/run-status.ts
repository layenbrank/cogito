/**
 * 运行状态展示与聚合：本会话 runs 优先，账本 last_run 补跨会话。
 */

import type { DirectiveEntry, DirectiveRun } from '@/shared/ipc/specs/sidecar'
import type { CorexRun, RunStatus } from '@/stores/corex'

interface MarkStyle {
  icon: string
  tone: string
  rail: string
}

interface StatusStyle extends MarkStyle {
  label: string
  dot: string
}

const RUN_STATUS_STYLES: Record<RunStatus, StatusStyle> = {
  running: {
    label: '运行中',
    icon: 'mdi:progress-clock',
    tone: 'text-primary',
    rail: 'bg-primary/60',
    dot: 'bg-primary'
  },
  ok: {
    label: '成功',
    icon: 'mdi:check-circle-outline',
    tone: 'text-success',
    rail: 'bg-success/70',
    dot: 'bg-success'
  },
  failed: {
    label: '失败',
    icon: 'mdi:alert-circle-outline',
    tone: 'text-destructive',
    rail: 'bg-destructive/70',
    dot: 'bg-destructive'
  }
}

const LOG_LEVEL_STYLES: Record<'info' | 'success' | 'error', MarkStyle> = {
  info: { icon: 'mdi:information-outline', tone: 'text-foreground', rail: 'border-border' },
  success: { icon: 'mdi:check-circle-outline', tone: 'text-success', rail: 'border-success/60' },
  error: {
    icon: 'mdi:alert-circle-outline',
    tone: 'text-destructive',
    rail: 'border-destructive/60'
  }
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

interface DirectiveRuns {
  status: RunStatus | null
  total: number
  running: number
  failed: number
  latest: CorexRun | null
  doneSteps: number
  lastAt: Date | null
  lastDurationMs: number | null
  baseline: DirectiveRun | null
  hasUnread: boolean
}

const EMPTY_RUNS: DirectiveRuns = {
  status: null,
  total: 0,
  running: 0,
  failed: 0,
  latest: null,
  doneSteps: 0,
  lastAt: null,
  lastDurationMs: null,
  baseline: null,
  hasUnread: false
}

function summarize(
  items: readonly CorexRun[],
  seenAt: number,
  baseline: DirectiveRun | null
): DirectiveRuns {
  const latest = items[items.length - 1]
  let running = 0
  let failed = 0
  let lastEndedAt = baseline ? baseline.ended_at_ms : 0

  items.forEach(function (run) {
    if (run.status === 'running') running += 1
    else if (run.status === 'failed') failed += 1
    if (run.endedAt) lastEndedAt = Math.max(lastEndedAt, run.endedAt.getTime())
  })

  const startedAt = latest ? latest.startedAt.getTime() : (baseline?.started_at_ms ?? 0)
  const status: RunStatus | null = running
    ? 'running'
    : (latest?.status ?? (baseline ? (baseline.ok ? 'ok' : 'failed') : null))

  return {
    status,
    total: items.length,
    running,
    failed,
    latest: latest ?? null,
    doneSteps: latest?.doneSteps ?? 0,
    lastAt: startedAt > 0 ? new Date(startedAt) : null,
    lastDurationMs: latest
      ? latest.endedAt
        ? latest.endedAt.getTime() - latest.startedAt.getTime()
        : null
      : (baseline?.duration_ms ?? null),
    baseline,
    hasUnread: lastEndedAt > seenAt
  }
}

function indexRunSummaries(
  runs: readonly CorexRun[],
  seen: Record<string, number> = {},
  lastRuns: Record<string, DirectiveRun> = {}
): Record<string, DirectiveRuns> {
  const byName: Record<string, CorexRun[]> = {}

  runs.forEach(function (run) {
    const items = byName[run.name]
    if (items) items.push(run)
    else byName[run.name] = [run]
  })

  const summaries: Record<string, DirectiveRuns> = {}
  Object.keys(byName).forEach(function (name) {
    summaries[name] = summarize(byName[name], seen[name] ?? 0, lastRuns[name] ?? null)
  })
  Object.keys(lastRuns).forEach(function (name) {
    if (summaries[name]) return
    summaries[name] = summarize([], seen[name] ?? 0, lastRuns[name])
  })
  return summaries
}

function indexLastRuns(directives: readonly DirectiveEntry[]): Record<string, DirectiveRun> {
  const lastRuns: Record<string, DirectiveRun> = {}
  directives.forEach(function (entry) {
    if (entry.last_run) lastRuns[entry.name] = entry.last_run
  })
  return lastRuns
}

function indexStepCounts(directives: readonly DirectiveEntry[]): Record<string, number> {
  const counts: Record<string, number> = {}
  directives.forEach(function (entry) {
    counts[entry.name] = entry.summary?.step_count ?? 0
  })
  return counts
}

function isRunning(run: CorexRun): boolean {
  return run.status === 'running'
}

function formatElapsed(run: CorexRun, now: number = Date.now()): string {
  const end = run.endedAt ? run.endedAt.getTime() : now
  return formatDuration(Math.max(0, end - run.startedAt.getTime()))
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < MINUTE_MS) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

function formatRelativeTime(at: Date, now: number = Date.now()): string {
  const ms = now - at.getTime()
  if (ms < MINUTE_MS) return '刚刚'
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} 分钟前`
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)} 小时前`
  if (ms < WEEK_MS) return `${Math.floor(ms / DAY_MS)} 天前`
  return `${at.getMonth() + 1}月${at.getDate()}日`
}

function formatAbsoluteTime(at: Date): string {
  function pad(value: number) {
    return String(value).padStart(2, '0')
  }
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  return `${date} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

export {
  DAY_MS,
  EMPTY_RUNS,
  HOUR_MS,
  LOG_LEVEL_STYLES,
  MINUTE_MS,
  RUN_STATUS_STYLES,
  WEEK_MS,
  formatAbsoluteTime,
  formatDuration,
  formatElapsed,
  formatRelativeTime,
  indexLastRuns,
  indexRunSummaries,
  indexStepCounts,
  isRunning
}
export type { DirectiveRuns, StatusStyle }
