/**
 * 运维控制台 → cogito 异常上报。
 *
 * 原则：上报失败绝不能再抛；也不上报「上报接口自身」以免回路。
 * 业务可预期错误（鉴权失效、校验失败）留给 toast，只上报崩溃与意外失败。
 * 同一 Error 实例只上报一次（边界 + onCaughtError / catch 再抛 等路径会撞到同一对象）。
 *
 * 防回路的四道闸（与 `apps/client` 同口径，见那边的长注释）：
 * 1. `isReporting` 单飞：上报在途时的任何新错误都不再进这条链路；
 * 2. 端点自识别：消息 / 请求 URL 命中 `/api/v1/exception` 直接跳过；
 * 3. 消息级短时去重：同一句话 5s 内只报一次（`window.error` 给的是字符串，没有对象身份）；
 * 4. 传输熔断：连续 3 次送不出去就停 60s —— 控制台这边没有重试队列，
 *    不熔断就等于「页面上每报一次错就打一次必然失败的请求」。
 */
import { POST_EXCEPTION, type ExceptionWrite } from '@/apis/exception.ts'
import { isSessionInvalid } from '@/utils/auth.ts'
import { HttpException } from '@/utils/http/errors.ts'

const SOURCE = 'backend'
const REPORT_PATH = '/exception'
/** 连续失败多少次后熔断。 */
const BREAKER_THRESHOLD = 3
/** 熔断时长。 */
const BREAKER_COOLDOWN_MS = 60_000
/** 同一句话的去重窗口。 */
const DEDUPE_WINDOW_MS = 5_000
/** 去重表上限，防长跑期间无限增长。 */
const MAX_RECENT_MESSAGES = 50
/** 上报端点特征：用于识别「上报自身失败」 */
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
}

let isInstalled = false
/** 上报进行中：防止 randomUUID/POST 失败再进 unhandledrejection → 死循环 */
let isReporting = false
/** 已上报过的 Error 实例，避免同一根因被多层 catch/边界连报 */
const reportedErrors = new WeakSet<object>()
/** 最近报过的消息 → 时间戳（字符串错误只能按文案去重） */
const recentMessages = new Map<string, number>()
/** 连续失败次数；成功一次即清零。 */
let consecutiveFailures = 0
/** 熔断截止时间戳（0 = 未熔断）。 */
let breakerUntil = 0

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
    return 'backend://unknown'
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

/** 这条错误是不是「上报接口自己」失败的产物 */
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

function isCoolingDown(now = Date.now()): boolean {
  return breakerUntil > now
}

function noteReportFailure(): void {
  consecutiveFailures += 1
  if (consecutiveFailures < BREAKER_THRESHOLD || isCoolingDown()) return
  breakerUntil = Date.now() + BREAKER_COOLDOWN_MS
  console.warn(
    `[exception-report] 上报端点连续失败 ${consecutiveFailures} 次，${BREAKER_COOLDOWN_MS / 1000}s 内不再发请求`
  )
}

function noteReportSuccess(): void {
  consecutiveFailures = 0
  breakerUntil = 0
}

function shouldSkip(error: unknown): boolean {
  if (isSessionInvalid(error)) return true
  if (!(error instanceof HttpException)) return false
  // 业务信封失败（非网络/非 5xx）通常已 toast，不当作崩溃上报
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

async function reportException(input: ReportInput): Promise<void> {
  if (isReporting) return
  const message = input.message.trim()
  if (!message) return
  // 熔断期直接丢掉：没有重试队列，继续打只会把失败刷成一串日志
  if (isCoolingDown()) return

  isReporting = true
  try {
    const body: ExceptionWrite = {
      eventID: createEventId(),
      message: message.slice(0, 2000),
      timestamp: Date.now(),
      url: (input.url ?? findPageURL()).slice(0, 2000),
      source: SOURCE,
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
    await POST_EXCEPTION(body)
    noteReportSuccess()
  } catch (error) {
    noteReportFailure()
    console.warn('[exception-report] 上报失败', error)
  } finally {
    isReporting = false
  }
}

function reportUnknown(
  error: unknown,
  context?: Record<string, unknown>,
  level: ExceptionLevel = 'error'
) {
  if (isReporting) return
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
  console.error(`[${scope}]`, error)
  reportUnknown(error, { kind: scope, ...context }, level)
}

function installExceptionReporting(): void {
  if (isInstalled || typeof window === 'undefined') return
  isInstalled = true

  window.addEventListener('error', function (event) {
    const target = event.target
    // 资源加载失败（img/script）不按 JS 崩溃上报
    if (target && target !== window) return
    reportUnknown(event.error ?? event.message, { kind: 'window.error' }, 'error')
  })

  window.addEventListener('unhandledrejection', function (event) {
    reportUnknown(event.reason, { kind: 'unhandledrejection' }, 'error')
  })
}

export {
  BREAKER_THRESHOLD,
  REPORT_PATH,
  SOURCE,
  installExceptionReporting,
  isCoolingDown,
  reportCaught,
  reportException,
  reportUnknown
}
export type { ExceptionLevel, ReportInput }
