/**
 * 崩溃补偿上报：把 Rust panic hook 落在磁盘上的现场，补报给
 * `apps/service` 的 `POST /api/v1/exception`。
 *
 * 链路：`diagnostics:pending` → 逐条组装 `ReportInput` → `reportException`
 * → 成功才 `diagnostics:ack` 删文件。
 *
 * 幂等靠 `crash.eventId`（Rust 侧生成 UUID，落盘时固定）：重复上报时服务端
 * 按 `eventID` 去重，所以「本次没送出去、下次启动再送」是安全的。
 * 连续失败 3 次后强制 ack，避免一条坏现场永远卡在磁盘上。
 */
import { invoke } from '@tauri-apps/api/core'

import { findPref, isPersistReady } from '@/features/persist'
import { push } from '@/lib/diagnostics/log-bridge'
import { reportException } from '@/utils/exception-report'

/** 同一份现场最多尝试上报几次 */
const MAX_REPORT_ATTEMPTS = 3
/** 上报里附带的日志尾巴上限（字符数，与服务端 `context` 体积匹配） */
const MAX_LOG_TAIL_CHARS = 8_192
/**
 * 失败计数只放内存：非密持久化在本仓要走 `@/features/persist`，为这点计数引入
 * 依赖不值当。跨启动的「不重复上报」由两件事保证：
 * 送达即 `ack` 删文件；超过 `MAX_CRASH_AGE_MS` 仍送不出去的现场直接放弃。
 */
const attemptCounts = new Map<string, number>()
/** 现场存活上限：超过就不必再试，避免断网用户磁盘上堆一堆死文件 */
const MAX_CRASH_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface PendingCrash {
  id: string
  eventId: string
  timestamp: number
  thread: string
  message: string
  location?: string | null
  backtrace: string
  appVersion: string
  os: string
}

interface SessionRecord {
  state: string
  pid: number
  startedAt: number
  endedAt?: number | null
}

interface PendingDiagnostics {
  crashes: PendingCrash[]
  session?: SessionRecord | null
  previousSessionCrashed: boolean
  logTail?: string | null
}

interface CrashReportResult {
  /** 本次成功送达并已删除的现场数量 */
  reported: number
  /** 仍留在磁盘上的数量（网络失败、次数未到上限） */
  kept: number
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function fingerprintOf(crash: PendingCrash): string {
  const location = crash.location ?? 'unknown'
  return `panic|${location}`.slice(0, 64)
}

async function ack(id: string): Promise<void> {
  try {
    await invoke('diagnostics:ack', { id })
  } catch (error) {
    console.warn('[crash-report] ack 失败（下次启动会再试）', error)
  }
}

/**
 * 上报所有待处理崩溃现场。启动时调用一次即可。
 * 任何异常都在内部吞掉 —— 补报失败绝不能拦住启动。
 */
async function reportPendingCrashes(): Promise<CrashReportResult> {
  const result: CrashReportResult = { reported: 0, kept: 0 }
  if (!isTauri()) return result

  // 「设置 → 诊断」里的开关：关掉后现场只留在本地，不再发送任何内容。
  // persist 没就绪时按默认（开）处理 —— 启动早期补报不该被存储层卡住。
  if (isPersistReady() && !findPref('diagnostics').reportCrashes) {
    console.info('[crash-report] 自动上报已关闭，跳过补报（现场保留在本地）')
    return result
  }

  let pending: PendingDiagnostics
  try {
    pending = await invoke<PendingDiagnostics>('diagnostics:pending')
  } catch (error) {
    console.warn('[crash-report] 读取待报现场失败', error)
    return result
  }

  const crashes = pending.crashes ?? []
  if (crashes.length === 0) return result

  const logTail = (pending.logTail ?? '').slice(0, MAX_LOG_TAIL_CHARS)

  for (const crash of crashes) {
    const age = Date.now() - crash.timestamp
    if (age > MAX_CRASH_AGE_MS) {
      console.warn(`[crash-report] 现场 ${crash.id} 已超过 7 天，放弃上报并清理`)
      await ack(crash.id)
      attemptCounts.delete(crash.eventId)
      continue
    }

    const tried = attemptCounts.get(crash.eventId) ?? 0
    if (tried >= MAX_REPORT_ATTEMPTS) {
      console.warn(`[crash-report] 现场 ${crash.id} 连续失败 ${tried} 次，放弃并清理`)
      await ack(crash.id)
      attemptCounts.delete(crash.eventId)
      continue
    }

    const delivered = await reportException({
      eventID: crash.eventId,
      source: 'client-desktop',
      level: 'fatal',
      message: `panic: ${crash.message}`,
      stack: crash.backtrace,
      url: 'client://panic',
      fingerprint: fingerprintOf(crash),
      context: {
        kind: 'rust-panic',
        crashId: crash.id,
        thread: crash.thread,
        location: crash.location ?? undefined,
        appVersion: crash.appVersion,
        os: crash.os,
        occurredAt: crash.timestamp,
        previousSessionCrashed: pending.previousSessionCrashed,
        sessionState: pending.session?.state,
        logTail: logTail || undefined
      }
    })

    if (delivered) {
      await ack(crash.id)
      attemptCounts.delete(crash.eventId)
      result.reported += 1
    } else {
      attemptCounts.set(crash.eventId, tried + 1)
      result.kept += 1
    }
  }

  if (result.reported > 0 || result.kept > 0) {
    // 落到 Rust 日志（cogito.log）里，未接调试器时也能看出补报到底成没成
    push('info', `补报完成：送达 ${result.reported} 份，保留 ${result.kept} 份`, 'crash-report')
  }

  return result
}

/** 磁盘上待上报的现场数量（设置 → 诊断用）。 */
async function pendingCrashCount(): Promise<number> {
  if (!isTauri()) return 0
  try {
    const pending = await invoke<PendingDiagnostics>('diagnostics:pending')
    return pending.crashes?.length ?? 0
  } catch (error) {
    console.warn('[crash-report] 读取数量失败', error)
    return 0
  }
}

export { MAX_REPORT_ATTEMPTS, pendingCrashCount, reportPendingCrashes }
export type { CrashReportResult, PendingCrash, PendingDiagnostics }
