/**
 * 前端日志桥：把 webview 侧的 `console.warn/error`、`window.onerror`、
 * `unhandledrejection` 送进 Rust 日志（`log` facade → `logs/cogito.log`）。
 *
 * 约束（和 `diagnostics:append` 的契约对齐）：
 * - 限流 **20 条/秒**，超出直接丢并记一条「被限流」的计数；
 * - 单条截断到 **4KB**，避免一条巨大 JSON 把日志刷爆；
 * - 每条带**当前 window label**（`main` / `overlay` / `capture`），
 *   一个窗口挂死时能从日志里区分是谁在刷；
 * - 非 Tauri 环境（浏览器预览）自动降级成什么都不做，绝不报错。
 */
import { invoke } from '@tauri-apps/api/core'

/** 一批最多攒多久（毫秒）就 flush 一次 */
const FLUSH_INTERVAL_MS = 250
/** 每秒最多放行多少条 */
const MAX_PER_SECOND = 20
/** 单条日志字符上限 */
const MAX_LINE_CHARS = 4_000
/** 本地缓冲上限（超过丢最旧） */
const MAX_BUFFER = 200

type BridgeLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'

interface LogEntry {
  level: BridgeLevel
  message: string
  target?: string
  window?: string
  timestamp?: number
}

let installed = false
let buffer: LogEntry[] = []
let droppedByRate = 0
let windowStart = 0
let windowCount = 0
let flushTimer: ReturnType<typeof setTimeout> | null = null
/** 原始 console 引用：停用桥时要还原 */
let originals: { warn: typeof console.warn; error: typeof console.error } | null = null

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 当前窗口 label；取不到就退化成 `main`（日志里不至于出现空列）。 */
function currentWindowLabel(): string {
  // 全程可选链：拿不到就退化成 `main`，不需要 try/catch
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } }
  }).__TAURI_INTERNALS__
  return internals?.metadata?.currentWindow?.label ?? 'main'
}

function truncate(input: string, max: number): string {
  if (input.length <= max) return input
  return `${input.slice(0, max)}…`
}

/** 把任意值安全地压成一行文本（Error 只取 name + message + 首行栈）。 */
function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) {
    const stackLine = (value.stack ?? '').split('\n')[1]?.trim() ?? ''
    return `${value.name}: ${value.message}${stackLine ? ` @ ${stackLine}` : ''}`
  }
  try {
    return JSON.stringify(value)
  }
  // eslint-disable-next-line ith/catch-must-report -- 本函数被 console 包装调用，写日志会自我递归；循环引用只能退回 String()
  catch {
    return String(value)
  }
}

function rateLimited(): boolean {
  const now = Date.now()
  if (now - windowStart >= 1_000) {
    windowStart = now
    windowCount = 0
  }
  windowCount += 1
  if (windowCount > MAX_PER_SECOND) {
    droppedByRate += 1
    return true
  }
  return false
}

function scheduleFlush(): void {
  if (flushTimer !== null) return
  flushTimer = setTimeout(function () {
    flushTimer = null
    void flush()
  }, FLUSH_INTERVAL_MS)
}

/** 立即把缓冲交给 Rust；失败只打一条原生 console.warn（不再经桥，避免回路）。 */
async function flush(): Promise<void> {
  if (buffer.length === 0) return
  const batch = buffer
  buffer = []
  if (droppedByRate > 0) {
    batch.push({
      level: 'warn',
      message: `日志桥限流：本批丢弃 ${droppedByRate} 条`,
      target: 'log-bridge',
      window: currentWindowLabel(),
      timestamp: Date.now()
    })
    droppedByRate = 0
  }
  try {
    await invoke('diagnostics:append', { entries: batch })
  }
  // eslint-disable-next-line ith/catch-must-report -- 下面用 nativeWarn 报过；再调 console.warn 会被自己的包装捕获 → 自我循环
  catch (error) {
    // 落盘通道自己坏了：停用桥并把 console 还原，避免每次 flush 都自喂一条日志
    disableBridge()
    nativeWarn('[log-bridge] flush 失败，日志桥已停用', error)
  }
}

/** 停用桥并还原 console（flush 失败时调用）。 */
function disableBridge(): void {
  installed = false
  if (originals) {
    console.warn = originals.warn
    console.error = originals.error
  }
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  buffer = []
}

function push(level: BridgeLevel, message: unknown, target = 'console'): void {
  if (!installed) return
  if (rateLimited()) return
  buffer.push({
    level,
    message: truncate(stringify(message), MAX_LINE_CHARS),
    target,
    window: currentWindowLabel(),
    timestamp: Date.now()
  })
  if (buffer.length > MAX_BUFFER) {
    buffer.splice(0, buffer.length - MAX_BUFFER)
  }
  scheduleFlush()
}

let nativeWarn: (...args: unknown[]) => void = function () {}

/**
 * 装日志桥。必须在 `installExceptionReporting()` **之前**调用：
 * 这样 `unhandledrejection` 的上报日志也能落到文件里。
 */
function installLogBridge(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const originalWarn = console.warn.bind(console)
  const originalError = console.error.bind(console)
  nativeWarn = originalWarn
  originals = { warn: originalWarn, error: originalError }

  if (!isTauri()) {
    // 浏览器预览：只保留原行为
    installed = false
    return
  }

  console.warn = function (...args: unknown[]) {
    originalWarn(...args)
    push('warn', args.map(stringify).join(' '), 'console.warn')
  }
  console.error = function (...args: unknown[]) {
    originalError(...args)
    push('error', args.map(stringify).join(' '), 'console.error')
  }

  window.addEventListener('error', function (event) {
    push(
      'error',
      `${event.message} @ ${event.filename ?? '?'}:${event.lineno ?? 0}:${event.colno ?? 0}`,
      'window.onerror'
    )
  })

  window.addEventListener('unhandledrejection', function (event) {
    push('error', stringify(event.reason), 'unhandledrejection')
  })

  // 页面即将卸载（关窗/重载）时把剩下的日志冲出去
  window.addEventListener('beforeunload', function () {
    void flush()
  })

  push('info', '日志桥已安装', 'log-bridge')
}

export { installLogBridge, push }
export type { BridgeLevel, LogEntry }
