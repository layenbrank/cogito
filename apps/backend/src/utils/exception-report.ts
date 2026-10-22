/**
 * 运维控制台 → cogito 异常上报。
 *
 * 原则：上报失败绝不能再抛；也不上报「上报接口自身」以免回路。
 * 业务可预期错误（鉴权失效、校验失败）留给 toast，只上报崩溃与意外失败。
 * 同一 Error 实例只上报一次（边界 + onCaughtError / catch 再抛 等路径会撞到同一对象）。
 */
import { POST_EXCEPTION, type ExceptionWrite } from '@/apis/exception.ts'
import { isSessionInvalid } from '@/utils/auth.ts'
import { HttpException } from '@/utils/http/errors.ts'

const SOURCE = 'backend'
const REPORT_PATH = '/exception'

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
/** 已上报过的 Error 实例，避免同一根因被多层 catch/边界连报 */
const reportedErrors = new WeakSet<object>()

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
  const message = input.message.trim()
  if (!message) return

  const body: ExceptionWrite = {
    eventID: crypto.randomUUID(),
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

  try {
    await POST_EXCEPTION(body)
  } catch (error) {
    console.warn('[exception-report] 上报失败', error)
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
    // 资源加载失败（img/script）不按 JS 崩溃上报
    if (target && target !== window) return
    reportUnknown(event.error ?? event.message, { kind: 'window.error' }, 'error')
  })

  window.addEventListener('unhandledrejection', function (event) {
    reportUnknown(event.reason, { kind: 'unhandledrejection' }, 'error')
  })
}

export {
  REPORT_PATH,
  SOURCE,
  installExceptionReporting,
  reportCaught,
  reportException,
  reportUnknown
}
export type { ExceptionLevel, ReportInput }
