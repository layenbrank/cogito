/**
 * 轻量可观测性：计数器 + 结构化日志。
 *
 * 为什么自己写而不是引 OpenTelemetry：agentd 是**单进程侧车**，一次只需要回答
 * 「这台机器上到底发生了什么」。引一整套 OTel（导出器、采样、context 传播）会让 SEA
 * 体积与启动时间都涨一截，而收益是「把数据送到一个目前还不存在的后端」。
 * 等真的要做多点聚合时，`snapshot()` 的形状改成 OTLP 的 metric 数据点即可，调用点不用动。
 *
 * 两个约定：
 *
 * 1. **一行一条 JSON**（`AGENTD_EVENT`）。日志是给人看的兜底，但机器要能 grep：
 *    `threadID` / `runID` / `node` / `gooseSessionId` / `status` / `durationMs` 一律平铺，
 *    不做嵌套，这样 `jq` 与 `Select-String` 都直接可用。
 * 2. **计数器只增不减**。需要「当前值」的（待审批数）走 `/health` 与接口查询，不在这里
 *    维护 Gauge —— 两处都存一份必然对不上。
 */

/** 目前关心的全部指标；新增时**同时**在这里显式列出，避免拼错名字后静默多出一个键 */
const METRIC_NAMES = [
  'runs.started',
  'runs.settled',
  'runs.failed',
  'runs.cancelled',
  'runs.preempted',
  'approvals.requested',
  'approvals.settled',
  'approvals.timeout',
  'elicitations.requested',
  'elicitations.settled',
  'elicitations.timeout',
  'events.sse.connections',
  'events.cursor.replays',
  'goose.restarts'
] as const

type MetricName = (typeof METRIC_NAMES)[number]

interface MetricsSnapshot {
  counters: Record<string, number>
  /** 每个指标最后一次观测的时间（毫秒时间戳），便于判断「最后一次是多久前」 */
  lastAt: Record<string, number>
  uptimeMs: number
}

interface Metrics {
  inc(name: MetricName, by?: number): void
  snapshot(): MetricsSnapshot
}

interface LogFields {
  threadID?: string
  runID?: string
  node?: string
  gooseSessionId?: string
  status?: string
  durationMs?: number
  [key: string]: unknown
}

interface Observability {
  metrics: Metrics
  /** 结构化一行：`AGENTD_EVENT {"event":"…","at":"…",…}` */
  event(name: string, fields?: LogFields): void
}

function createMetrics(startedAt = Date.now()): Metrics {
  const counters: Record<string, number> = {}
  const lastAt: Record<string, number> = {}
  for (const name of METRIC_NAMES) counters[name] = 0

  return {
    inc: function (name: MetricName, by = 1): void {
      counters[name] = (counters[name] ?? 0) + by
      lastAt[name] = Date.now()
    },
    snapshot: function (): MetricsSnapshot {
      return {
        counters: { ...counters },
        lastAt: { ...lastAt },
        uptimeMs: Date.now() - startedAt
      }
    }
  }
}

function createObservability(): Observability {
  const metrics = createMetrics()
  return {
    metrics,
    event: function (name: string, fields?: LogFields): void {
      // JSON.stringify 自己会处理 undefined（丢掉该键），所以调用方不必清理
      console.log(`AGENTD_EVENT ${JSON.stringify({ event: name, at: new Date().toISOString(), ...fields })}`)
    }
  }
}

export { METRIC_NAMES, createMetrics, createObservability }
export type { LogFields, MetricName, Metrics, MetricsSnapshot, Observability }
