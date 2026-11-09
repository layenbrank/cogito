/**
 * 客户端 → cogito 异常上报。
 *
 * 原则：上报失败绝不能再抛；也不上报「上报接口自身」以免回路。
 * 业务可预期错误留给 toast，只上报崩溃与意外失败。
 * 同一 Error 实例只上报一次（边界 + onCaughtError / catch 再抛 等路径会撞到同一对象）。
 *
 * 与旧版的差异：不再用 `isReporting` 单飞丢事件，改成**有界队列**——
 * 失败按 1.5s / 5s / 15s 退避重试，最多 3 次，队列最长保留最近 50 条。
 * 队列里只存「已组装好的 body」，不持有 Error 实例（避免闭包长期占内存）。
 *
 * 防回路（上报自己把自己喂回队列）的四道闸：
 * 1. `inFlightReports` 重入闸：上报请求在途时产生的一切错误都不再生成新事件；
 * 2. 端点自识别：消息 / 请求 URL 命中 `/api/v1/exception` 直接跳过（报错文案里就带 URL）；
 * 3. 消息级短时去重：同一句话 5s 内只报一次 —— `window.error` 给的是字符串，没有对象身份可认；
 * 4. 传输熔断：连续 3 次送不出去就暂停 60s，期间**只入队、不打请求**。
 *    没有它时后端不可达会变成「每个事件 3 次退避 × 每个失败又触发新事件」的自激循环。
 */
import { POST_EXCEPTION, type ExceptionWrite } from '@/apis/exception'
import { isExpectedError } from '@/utils/expected-error'
import { HttpException } from '@/utils/http/errors.ts'

const SOURCE = 'client'
/** 队列上限：超出丢最旧的，保证崩溃风暴下内存可控。 */
const MAX_QUEUE = 50
/** 单条最多尝试次数。 */
const MAX_ATTEMPTS = 3
/** 退避序列（毫秒）。 */
const BACKOFF_MS = [1_500, 5_000, 15_000] as const
/** 单轮 drain 的硬上限，防「一直失败一直重试」把循环卡死。 */
const MAX_DRAIN_STEPS = MAX_QUEUE * MAX_ATTEMPTS
/** 连续失败多少次后熔断。 */
const BREAKER_THRESHOLD = 3
/** 熔断时长：够后端重启，又不会让队列永远不重试。 */
const BREAKER_COOLDOWN_MS = 60_000
/** 同一句话的去重窗口。 */
const DEDUPE_WINDOW_MS = 5_000
/** 去重表上限，防长跑期间无限增长。 */
const MAX_RECENT_MESSAGES = 50
/** 上报端点特征：既用于识别「上报自身失败」，也是熔断归因的唯一线索。 */
const REPORT_ENDPOINT_HINT = /\/api\/v1\/exception\b/

type ExceptionLevel = 'fatal' | 'error' | 'warning' | 'info'

interface ReportInput {
  message: string
  stack?: string | null
  level?: ExceptionLevel
  status?: number | null
  method?: string | null
  url?: string
  reqID?: string | null
  context?: Record<string, unknown>
  fingerprint?: string
  /** `client`（默认）/ `client-desktop`（Rust panic 补报） */
  source?: string
  /** 幂等键；崩溃补报必须传，重试时服务端按它去重 */
  eventID?: string
}

interface QueueItem {
  body: ExceptionWrite
  attempts: number
}

let isInstalled = false
/** 已上报过的 Error 实例（内存内去重，不参与持久化） */
const reportedErrors = new WeakSet<object>()
/** 最近报过的消息 → 时间戳（字符串错误没有对象身份，只能按文案去重） */
const recentMessages = new Map<string, number>()

const pending: QueueItem[] = []
let draining = false
/** 上报请求在途计数：>0 时不再接受新上报（防自身失败被当成新异常）。 */
let inFlightReports = 0
/** 连续失败次数；成功一次即清零。 */
let consecutiveFailures = 0
/** 熔断截止时间戳（0 = 未熔断）。 */
let breakerUntil = 0
/** 熔断结束后补一次排空的定时器。 */
let recoveryTimer: ReturnType<typeof setTimeout> | null = null

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

/** 非安全上下文可能没有 `crypto.randomUUID`（HTTP / 部分嵌入 WebView） */
function createEventId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, function (byte) {
    return byte.toString(16).padStart(2, '0')
  }).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function findRelease(): string | undefined {
  const value = String(import.meta.env.VITE_APP_VERSION ?? '').trim()
  return value || undefined
}

function findPageURL(): string {
  try {
    return window.location.href
  } catch (error) {
    console.warn('[exception-report] 读取 location 失败', error)
    return 'client://unknown'
  }
}

function parseMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch (serializeError) {
    console.warn('[exception-report] 序列化错误消息失败', serializeError)
    return '未知错误'
  }
}

function parseStack(error: unknown): string | undefined {
  if (error instanceof Error && error.stack) return error.stack.slice(0, 20_000)
  return undefined
}

/** 报文里是否需要再补一个 error message 的反向引用（防止无限套娃） */
function isReportEndpointError(error: unknown): boolean {
  if (typeof error === 'string') return REPORT_ENDPOINT_HINT.test(error)
  if (error instanceof Error && REPORT_ENDPOINT_HINT.test(error.message)) return true
  if (error === null || typeof error !== 'object') return false
  // ofetch FetchError 会把请求 URL 挂在 `request` 上
  const request = (error as { request?: unknown }).request
  return typeof request === 'string' && REPORT_ENDPOINT_HINT.test(request)
}

/** 同一句话短时间内只认领一次；返回 false 表示「刚报过，跳过」。 */
function claimMessage(message: string): boolean {
  const now = Date.now()
  const seenAt = recentMessages.get(message)
  if (seenAt !== undefined && now - seenAt < DEDUPE_WINDOW_MS) return false
  if (recentMessages.size >= MAX_RECENT_MESSAGES) {
    for (const [key, at] of recentMessages) {
      if (now - at >= DEDUPE_WINDOW_MS) recentMessages.delete(key)
    }
    const oldest = recentMessages.keys().next().value
    if (recentMessages.size >= MAX_RECENT_MESSAGES && oldest !== undefined) {
      recentMessages.delete(oldest)
    }
  }
  recentMessages.set(message, now)
  return true
}

function shouldSkip(error: unknown): boolean {
  // 用户能自己修的失败（目录不存在、供应商没配）：界面上说清楚就够了，不进异常表
  if (isExpectedError(error)) return true
  if (!(error instanceof HttpException)) return false
  if (error.code > 0 && error.code !== 200000 && (!error.status || error.status < 500)) {
    return true
  }
  return false
}

/** 若已报过同一对象则返回 true（应跳过）；否则记入并返回 false */
function hasReported(error: unknown): boolean {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
    return false
  }
  if (reportedErrors.has(error)) return true
  reportedErrors.add(error)
  return false
}

/** 队列长度（设置 → 诊断里展示，也方便单测断言）。 */
function pendingReportCount(): number {
  return pending.length
}

/** 是否处于熔断冷却期（单测与诊断面板用）。 */
function isCoolingDown(now = Date.now()): boolean {
  return breakerUntil > now
}

function noteReportFailure(): void {
  consecutiveFailures += 1
  if (consecutiveFailures < BREAKER_THRESHOLD || isCoolingDown()) return
  breakerUntil = Date.now() + BREAKER_COOLDOWN_MS
  console.warn(
    `[exception-report] 上报端点连续失败 ${consecutiveFailures} 次，${BREAKER_COOLDOWN_MS / 1000}s 内只入队不发请求`
  )
}

function noteReportSuccess(): void {
  consecutiveFailures = 0
  breakerUntil = 0
}

/** 熔断结束把积压队列再排一次；没有它，恢复只能等下一次异常发生。 */
function scheduleRecovery(): void {
  if (recoveryTimer) return
  const delay = Math.max(0, breakerUntil - Date.now())
  recoveryTimer = setTimeout(function () {
    recoveryTimer = null
    drainSafely()
  }, delay)
}

/** 发一次上报；在途期间置重入闸（这条链路里抛出的错误一律不再上报） */
async function deliver(body: ExceptionWrite): Promise<void> {
  inFlightReports += 1
  try {
    await POST_EXCEPTION(body)
  } finally {
    inFlightReports -= 1
  }
}

/** 排空队列：永不 reject —— unhandledrejection 会被自己的监听器接住再上报，那就是回路 */
function drainSafely(): void {
  void drain().catch(function (error) {
    console.warn('[exception-report] 排空上报队列异常，已忽略', error)
  })
}

/** 后台排空队列：串行 POST，失败退避，最多 MAX_ATTEMPTS 次；熔断期直接不打网络。 */
async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    let steps = 0
    while (pending.length > 0 && steps < MAX_DRAIN_STEPS) {
      if (isCoolingDown()) {
        scheduleRecovery()
        return
      }
      steps += 1
      const item = pending[0]
      if (!item) break
      try {
        await deliver(item.body)
        noteReportSuccess()
        pending.shift()
      } catch (error) {
        noteReportFailure()
        item.attempts += 1
        if (item.attempts >= MAX_ATTEMPTS) {
          pending.shift()
          console.warn('[exception-report] 上报失败，已放弃', item.body.eventID, error)
          continue
        }
        console.warn('[exception-report] 上报失败，稍后重试', item.body.eventID, error)
        if (isCoolingDown()) {
          // 熔断已打开：别再把剩下的条目挨个打一遍，留着冷却结束后一起排
          scheduleRecovery()
          return
        }
        await sleep(BACKOFF_MS[Math.min(item.attempts - 1, BACKOFF_MS.length - 1)])
      }
    }
  } finally {
    draining = false
  }
}

function enqueue(body: ExceptionWrite): void {
  pending.push({ body, attempts: 0 })
  if (pending.length > MAX_QUEUE) {
    const overflow = pending.length - MAX_QUEUE
    pending.splice(0, overflow)
    console.warn(`[exception-report] 队列溢出，丢弃最旧 ${overflow} 条`)
  }
  drainSafely()
}

/**
 * 上报一条异常。返回是否**立即投递成功**（队列满/正在退避/熔断时为 false）。
 *
 * 崩溃补报依赖这个返回值：只有 `true` 才 ack 掉磁盘上的现场，
 * 否则下次启动重试（`eventID` 相同，服务端幂等）。
 */
async function reportException(input: ReportInput): Promise<boolean> {
  const message = input.message.trim()
  if (!message) return false
  // 重入闸：上报链路自己在途时，任何新「异常」都只可能是它自己的失败，丢掉
  if (inFlightReports > 0) return false

  const body: ExceptionWrite = {
    eventID: input.eventID ?? createEventId(),
    message: message.slice(0, 2000),
    timestamp: Date.now(),
    url: (input.url ?? findPageURL()).slice(0, 2000),
    source: input.source ?? SOURCE,
    level: input.level ?? 'error',
    environment: import.meta.env.MODE,
    release: findRelease(),
    stack: input.stack ?? undefined,
    status: input.status ?? undefined,
    method: input.method ?? undefined,
    reqID: input.reqID ?? undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : undefined,
    context: input.context,
    fingerprint: input.fingerprint
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    console.warn('[exception-report] 当前离线，上报已入队')
    enqueue(body)
    return false
  }

  if (isCoolingDown()) {
    // 熔断期只入队：后端不可达时继续打请求只会把失败堆成风暴
    enqueue(body)
    return false
  }

  try {
    await deliver(body)
    noteReportSuccess()
    return true
  } catch (error) {
    noteReportFailure()
    console.warn('[exception-report] 上报失败，已入队重试', error)
    enqueue(body)
    return false
  }
}

function reportUnknown(
  error: unknown,
  context?: Record<string, unknown>,
  level: ExceptionLevel = 'error'
) {
  // 四道闸：在途 / 端点自身 / 可预期失败 / 已报过 / 刚报过同一句话
  if (inFlightReports > 0) return
  if (isReportEndpointError(error)) return
  if (shouldSkip(error)) return
  if (hasReported(error)) return
  const message = parseMessage(error)
  if (!claimMessage(message)) return

  const http = error instanceof HttpException ? error : null
  void reportException({
    message,
    stack: parseStack(error),
    level,
    status: http?.status ?? null,
    reqID: http?.traceId ?? null,
    context: {
      ...context,
      name: error instanceof Error ? error.name : undefined,
      code: http?.code
    }
  })
}

/** catch 现场：打日志 + 上报（主要逻辑点统一入口） */
function reportCaught(
  scope: string,
  error: unknown,
  level: ExceptionLevel = 'error',
  context?: Record<string, unknown>
) {
  // 可预期失败是「用户下一步该做什么」的问题，不是代码缺陷：降级成 warn，别刷红
  if (isExpectedError(error)) {
    console.warn(`[${scope}]`, error.message)
    return
  }
  console.error(`[${scope}]`, error)
  reportUnknown(error, { kind: scope, ...context }, level)
}

function installExceptionReporting(): void {
  if (isInstalled || typeof window === 'undefined') return
  isInstalled = true

  window.addEventListener('error', function (event) {
    const target = event.target
    if (target && target !== window) return
    reportUnknown(event.error ?? event.message, { kind: 'window.error' }, 'error')
  })

  window.addEventListener('unhandledrejection', function (event) {
    reportUnknown(event.reason, { kind: 'unhandledrejection' }, 'error')
  })
}

export {
  SOURCE,
  BREAKER_THRESHOLD,
  MAX_ATTEMPTS,
  MAX_QUEUE,
  installExceptionReporting,
  isCoolingDown,
  pendingReportCount,
  reportCaught,
  reportException,
  reportUnknown
}
export type { ExceptionLevel, ReportInput }
