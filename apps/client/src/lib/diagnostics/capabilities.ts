/**
 * 诊断能力的前端包装：`diagnostics:capabilities`（版本/档位/目录）与
 * `capabilities:probe`（运行期工具清点）。
 *
 * 两个命令都在 Rust 侧做过兜底，这里只需要把 `invoke` 的异常收成 `null`，
 * 让「设置 → 诊断」在任何情况下都能渲染出来 —— 诊断页自己崩掉是最难查的一类
 * 故障，所以它宁可显示「读取失败」也不抛。
 */
import { invoke } from '@tauri-apps/api/core'

/** 单个外部工具的探测结果 */
interface ToolCapability {
  key: string
  label: string
  present: boolean
  path?: string | null
  version?: string | null
  /** 只有完整版内置（精简版缺它是正常现象） */
  fullOnly: boolean
  hint?: string | null
}

interface Capabilities {
  /** `slim` / `full` */
  variant: string
  platform: string
  arch: string
  tools: ToolCapability[]
}

interface DiagnosticsCapabilities {
  appVersion: string
  identifier: string
  /** `slim` / `full` */
  variant: string
  platform: string
  arch: string
  appDataDir?: string | null
  logDir?: string | null
  diagnosticsDir?: string | null
  crashDir?: string | null
  pendingCrashCount: number
  sessionState?: string | null
  /** 单个日志文件上限（字节） */
  logMaxFileSize: number
}

/** 可被「打开」的目录种类（与 Rust `diagnostics:open-dir` 对齐） */
type DiagnosticDirKind = 'log' | 'crash' | 'data'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function probeCapabilities(): Promise<Capabilities | null> {
  if (!isTauri()) return null
  try {
    return await invoke<Capabilities>('capabilities:probe')
  } catch (error) {
    console.warn('[diagnostics] capabilities:probe 失败', error)
    return null
  }
}

async function readDiagnosticsCapabilities(): Promise<DiagnosticsCapabilities | null> {
  if (!isTauri()) return null
  try {
    return await invoke<DiagnosticsCapabilities>('diagnostics:capabilities')
  } catch (error) {
    console.warn('[diagnostics] diagnostics:capabilities 失败', error)
    return null
  }
}

/**
 * 用系统文件管理器打开诊断相关目录，返回真正打开的路径（失败为 `null`）。
 *
 * 走 Rust 侧命令而不是前端插件：`diagnostics:open-dir` 里目录来源与
 * `diagnostics:capabilities` 同源，不会出现「显示一个路径、打开另一个路径」。
 */
async function openDiagnosticDir(kind: DiagnosticDirKind): Promise<string | null> {
  if (!isTauri()) return null
  try {
    return await invoke<string>('diagnostics:open-dir', { kind })
  } catch (error) {
    console.warn(`[diagnostics] 打开 ${kind} 目录失败`, error)
    return null
  }
}

/** 字节数 → 便于阅读的 MB 文案（只用于展示，保留一位小数） */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export { formatBytes, openDiagnosticDir, probeCapabilities, readDiagnosticsCapabilities }
export type {
  Capabilities,
  DiagnosticDirKind,
  DiagnosticsCapabilities,
  ToolCapability
}
