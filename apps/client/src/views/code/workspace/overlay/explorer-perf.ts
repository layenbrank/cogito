/**
 * Explorer 性能埋点（只加观测，不改行为）。
 *
 * 口径与 `lib/perf/longtask.ts` 对齐：那边量的是「主线程被不可中断占用」，
 * 这里量的是「一次目录读取 → 下一帧落地」的总耗时，用来回答「展开这个目录
 * 到底花了多少、其中读盘多少、其中渲染多少」。
 *
 * 只在 DEV 打开；生产环境 `startExplorerOp` 直接返回空实现，零开销。
 */

type ExplorerScope = 'fetch' | 'refresh'

interface ExplorerTraceEntry {
  scope: ExplorerScope
  /** 相对路径（根为空串） */
  relative: string
  /** 这一层目录的子项数 */
  count: number
  /** 读盘 + 排序耗时（ms） */
  readMs: number
  /** 从开始到「下一帧」的耗时（ms），含 React 渲染与样式布局 */
  frameMs: number
  /** 记录时刻（epoch ms），方便和日志时间线对齐 */
  at: number
}

interface ExplorerTraceSnapshot {
  since: number
  total: number
  maxFrameMs: number
  records: readonly ExplorerTraceEntry[]
}

type ScheduleFrame = (callback: () => void) => void

interface ExplorerOpTrace {
  /** 报出这一层的子项数 */
  count: (value: number) => ExplorerOpTrace
  /** 报出读盘 + 排序耗时 */
  read: (ms: number) => ExplorerOpTrace
  /** 落到下一帧时收尾（幂等） */
  settle: () => void
}

/** 只保留最近 50 条：长期运行不为埋点吃内存 */
const MAX_TRACES = 50

let entries: ExplorerTraceEntry[] = []
let total = 0
let maxFrameMs = 0
let since = Date.now()

function isExplorerPerfEnabled(): boolean {
  return Boolean(import.meta.env?.DEV)
}

function perfNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function defaultScheduleFrame(callback: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(function () {
      callback()
    })
    return
  }
  // 非浏览器环境（单测 / SSR）退化成微任务，保持「一定会收尾」的语义
  setTimeout(callback, 0)
}

/** 摘要文本：`[explorer] fetch src 42 项 读 3ms 帧 18ms` */
function formatExplorerTrace(entry: ExplorerTraceEntry): string {
  const label = entry.relative || '(root)'
  return `[explorer] ${entry.scope} ${label} ${entry.count} 项 读 ${Math.round(entry.readMs)}ms 帧 ${Math.round(entry.frameMs)}ms`
}

function publishSnapshot(): void {
  if (typeof window === 'undefined') return
  const snapshot: ExplorerTraceSnapshot = {
    since,
    total,
    maxFrameMs,
    records: entries.slice()
  }
  ;(window as unknown as { __cogitoExplorer?: ExplorerTraceSnapshot }).__cogitoExplorer =
    snapshot
}

function recordEntry(entry: ExplorerTraceEntry): void {
  total += 1
  if (entry.frameMs > maxFrameMs) maxFrameMs = entry.frameMs
  entries = entries.length >= MAX_TRACES ? entries.slice(entries.length - MAX_TRACES + 1) : entries
  entries.push(entry)
  publishSnapshot()
  console.debug(formatExplorerTrace(entry))
}

/**
 * 开一个计时。`settle()` 在**下一帧**收尾，所以 `frameMs` 包含 React 渲染 +
 * 样式布局；调用方只需在 `setTreeNodes` 之后调一次。
 */
function startExplorerOp(
  scope: ExplorerScope,
  relative: string,
  scheduleFrame: ScheduleFrame = defaultScheduleFrame
): ExplorerOpTrace {
  if (!isExplorerPerfEnabled()) {
    const noop: ExplorerOpTrace = {
      count: function () {
        return noop
      },
      read: function () {
        return noop
      },
      settle: function () {}
    }
    return noop
  }

  const startedAt = perfNow()
  let count = 0
  let readMs = 0
  let isSettled = false
  const trace: ExplorerOpTrace = {
    count: function (value: number) {
      count = Number.isFinite(value) ? value : 0
      return trace
    },
    read: function (ms: number) {
      readMs = Number.isFinite(ms) ? ms : 0
      return trace
    },
    settle: function () {
      if (isSettled) return
      isSettled = true
      scheduleFrame(function () {
        recordEntry({
          scope,
          relative,
          count,
          readMs,
          frameMs: perfNow() - startedAt,
          at: Date.now()
        })
      })
    }
  }
  return trace
}

function readExplorerSnapshot(): ExplorerTraceSnapshot {
  return { since, total, maxFrameMs, records: entries.slice() }
}

function resetExplorerPerf(nextSince = Date.now()): void {
  entries = []
  total = 0
  maxFrameMs = 0
  since = nextSince
  publishSnapshot()
}

export {
  MAX_TRACES,
  formatExplorerTrace,
  isExplorerPerfEnabled,
  perfNow,
  readExplorerSnapshot,
  resetExplorerPerf,
  startExplorerOp
}
export type {
  ExplorerOpTrace,
  ExplorerScope,
  ExplorerTraceEntry,
  ExplorerTraceSnapshot,
  ScheduleFrame
}
