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
 */
import { POST_EXCEPTION, type ExceptionWrite } from '@/apis/exception'
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

const pending: QueueItem[] = []
let draining = false

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

function shouldSkip(error: unknown): boolean {
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

/** 后台排空队列：串行 POST，失败退避，最多 MAX_ATTEMPTS 次。 */
async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    let steps = 0
    while (pending.length > 0 && steps < MAX_DRAIN_STEPS) {
      steps += 1
      const item = pending[0]
      if (!item) break
      try {
        await POST_EXCEPTION(item.body)
        pending.shift()
      } catch (error) {
        item.attempts += 1
        if (item.attempts >= MAX_ATTEMPTS) {
          pending.shift()
          console.warn('[exception-report] 上报失败，已放弃', item.body.eventID, error)
          continue
        }
        console.warn('[exception-report] 上报失败，稍后重试', item.body.eventID, error)
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
  void drain()
}

/**
 * 上报一条异常。返回是否**立即投递成功**（队列满/正在退避时为 false）。
 *
 * 崩溃补报依赖这个返回值：只有 `true` 才 ack 掉磁盘上的现场，
 * 否则下次启动重试（`eventID` 相同，服务端幂等）。
 */
async function reportException(input: ReportInput): Promise<boolean> {
  const message = input.message.trim()
  if (!message) return false

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

  try {
    await POST_EXCEPTION(body)
    return true
  } catch (error) {
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
  if (shouldSkip(error)) return
  if (hasReported(error)) return
  const http = error instanceof HttpException ? error : null
  void reportException({
    message: parseMessage(error),
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
  MAX_ATTEMPTS,
  MAX_QUEUE,
  installExceptionReporting,
  pendingReportCount,
  reportCaught,
  reportException,
  reportUnknown
}
export type { ExceptionLevel, ReportInput }
