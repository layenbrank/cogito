/**
 * 客户端 → cogito 异常上报。
 *
 * 原则：上报失败绝不能再抛；也不上报「上报接口自身」以免回路。
 * 业务可预期错误留给 toast，只上报崩溃与意外失败。
 */
import { POST_EXCEPTION, type ExceptionWrite } from '@/apis/exception'
import { HttpException } from '@/utils/http/errors.ts'

const SOURCE = 'client'

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
let isReporting = false

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

async function reportException(input: ReportInput): Promise<void> {
  if (isReporting) return
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

  isReporting = true
  try {
    await POST_EXCEPTION(body)
  } catch (error) {
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
  if (shouldSkip(error)) return
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

export { SOURCE, installExceptionReporting, reportException, reportUnknown }
export type { ExceptionLevel, ReportInput }
