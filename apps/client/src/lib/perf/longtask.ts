/**
 * 长任务可观测（对齐 VS Code 的 `EditorPerformanceReporter`）。
 *
 * 为什么需要它：这一轮的性能改动全是「把工作移出关键路径」，但用户感知的仍是
 * 「卡不卡」。只测帧率会飘，`PerformanceObserver('longtask')` 给的是**主线程被
 * 不可中断占用**的客观数字，正好对应「进代码页卡死」这类症状。
 *
 * 口径：
 * - 阈值默认 120ms（超过 50ms 是 long task 定义，但 50–120ms 这段时间在桌面端
 *   用户基本无感，全部打日志会把信噪比打没；120ms 起才算「会感觉到顿」）；
 * - `records` 只保留最近 50 条，避免长期运行把内存吃满；
 * - 生产环境只计数 + 暴露 `window.__cogitoPerf`，不发请求、不写日志（免得刷屏）。
 */

export interface LongTaskEntry {
  startTime: number
  duration: number
}

export interface LongTaskRecord extends LongTaskEntry {
  /** 观察到的时刻（`Date.now()`），用于和日志时间线对齐 */
  at: number
}

export interface LongTaskSnapshot {
  /** 本次统计起点（epoch ms） */
  since: number
  /** 观察到的长任务总数（不受阈值影响） */
  total: number
  /** 达到阈值、也就是会明显顿住的条数 */
  slow: number
  /** 观察到的最大 duration（ms） */
  maxDuration: number
  /** 最近 `keep` 条记录（新的在后） */
  records: readonly LongTaskRecord[]
}

export interface SummarizeOptions {
  now: number
  /** 计入 `slow` 的阈值，默认 {@link SLOW_TASK_MS} */
  thresholdMs?: number
  /** 保留的记录条数，默认 {@link MAX_LONG_TASK_RECORDS} */
  keep?: number
}

const SLOW_TASK_MS = 120
const MAX_LONG_TASK_RECORDS = 50

function createSnapshot(since: number): LongTaskSnapshot {
  return { since, total: 0, slow: 0, maxDuration: 0, records: [] }
}

/**
 * 把一批 longtask entry 并入快照。纯函数：不读全局、不改入参，便于单测。
 */
function summarizeLongTasks(
  entries: readonly LongTaskEntry[],
  previous: LongTaskSnapshot | null,
  options: SummarizeOptions
): LongTaskSnapshot {
  const thresholdMs = options.thresholdMs ?? SLOW_TASK_MS
  const keep = Math.max(1, options.keep ?? MAX_LONG_TASK_RECORDS)
  const base = previous ?? createSnapshot(options.now)

  let slow = base.slow
  let maxDuration = base.maxDuration
  const records: LongTaskRecord[] = base.records.slice()

  for (const entry of entries) {
    const duration = Number.isFinite(entry.duration) ? entry.duration : 0
    if (duration >= thresholdMs) slow += 1
    if (duration > maxDuration) maxDuration = duration
    records.push({ startTime: entry.startTime, duration, at: options.now })
  }

  return {
    since: base.since,
    total: base.total + entries.length,
    slow,
    maxDuration,
    records: records.length > keep ? records.slice(records.length - keep) : records
  }
}

declare global {
  interface Window {
    __cogitoPerf?: LongTaskSnapshot
  }
}

let snapshot: LongTaskSnapshot | null = null

function readLongTaskSnapshot(): LongTaskSnapshot {
  return snapshot ?? createSnapshot(Date.now())
}

function resetLongTaskSnapshot(since = Date.now()): void {
  snapshot = createSnapshot(since)
}

function publish(next: LongTaskSnapshot): void {
  snapshot = next
  if (typeof window !== 'undefined') window.__cogitoPerf = next
}

/**
 * 启动观测。返回取消函数（卸载/测试收尾用）。
 *
 * 不支持 longtask 的 webview 直接空转 —— 宁可没有数字，也不要抛错拖垮启动。
 */
function installLongTaskMonitor(options?: { thresholdMs?: number; isDev?: boolean }): () => void {
  const thresholdMs = options?.thresholdMs ?? SLOW_TASK_MS
  const isDev = options?.isDev ?? import.meta.env.DEV
  resetLongTaskSnapshot()

  if (typeof PerformanceObserver === 'undefined') return function () {}
  const supported = PerformanceObserver.supportedEntryTypes
  if (Array.isArray(supported) && !supported.includes('longtask')) return function () {}

  const observer = new PerformanceObserver(function (list) {
    const entries = list.getEntries().map(function (entry) {
      return { startTime: entry.startTime, duration: entry.duration }
    })
    if (entries.length === 0) return
    const next = summarizeLongTasks(entries, snapshot, { now: Date.now(), thresholdMs })
    publish(next)
    if (!isDev) return
    for (const entry of entries) {
      if (entry.duration < thresholdMs) continue
      console.warn('[perf] 长任务', Math.round(entry.duration), 'ms')
    }
  })

  try {
    // buffered：把启动阶段（首屏最卡的几秒）已经发生的长任务也捞进来
    observer.observe({ type: 'longtask', buffered: true })
  } catch (error) {
    console.warn('[perf] longtask 观测不可用', error)
    return function () {}
  }

  return function () {
    observer.disconnect()
  }
}

export {
  MAX_LONG_TASK_RECORDS,
  SLOW_TASK_MS,
  createSnapshot,
  installLongTaskMonitor,
  readLongTaskSnapshot,
  resetLongTaskSnapshot,
  summarizeLongTasks
}
