/**
 * 诊断接口：运行环境探测、目录打开、Agent 缓存、构建指纹、崩溃回执、日志回填。
 *
 * 「探测类」命令（能力 / 构建 / 缓存）失败时**不抛**，直接给 `null` 并留一行 warn ——
 * 「设置 → 诊断」是查故障的页面，它自己崩掉是最难查的一类问题，所以宁可显示
 * 「读取失败」。调用方因此不再需要包 try/catch。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

// ------------------------------------------------------------ 类型（Rust 契约）

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
  /** 当前平台能不能在线补装（`ffprobe` 跟着 `ffmpeg` 走） */
  installable: boolean
  /** 是否来自运行时下载目录（可以卸载） */
  installed: boolean
  /** 安装 / 卸载时传的包键（`ffprobe` → `ffmpeg`）；不可安装为 null */
  installKey?: string | null
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

/** Agent 缓存概况（`agent_cache_info`）：终端里那些临时脚本 / 日志的落点 */
interface AgentCacheStats {
  /** 缓存根：`%LOCALAPPDATA%\\Temp\\cogito\\agent-cache`（Temp 是系统清理域；旧目录只做只读提示） */
  path: string
  bytes: number
  /** 会话子目录个数 */
  sessions: number
  /** 旧目录（`~/.cogito/agent-cache`）仍存在时给出，提示可手动删 */
  legacyPath?: string | null
  /** 旧目录占用字节数（「可释放 N MB」提示用） */
  legacyBytes?: number
  /** 自动淘汰上限（字节） */
  maxBytes?: number
  /** 最近一次自动清理的时刻（epoch 毫秒），没清理过为 null */
  lastPrunedAt?: number | null
  /** 最近一次自动清理释放的字节数 */
  lastPrunedBytes?: number
}

/**
 * 宿主构建指纹（`app_build_info`）。
 *
 * dev 里最常见的假回归是「宿主没重建」：前端热更新了，Rust 侧还是启动时那个进程，
 * 于是「截图超时 / 拦截不命中 / 终端没有 COGITO_AGENT_CACHE」全被当成新 bug 去查。
 * 链接时间早于最近一次构建时间，就说明该重启了。
 */
interface BuildInfo {
  version: string
  /** `debug` / `release` */
  profile: string
  /** 当前进程的可执行文件绝对路径 */
  exe: string
  /** 可执行文件 mtime（即链接时间，ms since epoch）；0 = 读不到 */
  exeModifiedMs: number
  pid: number
}

/** 可被「打开」的目录种类（与 Rust `diagnostics:open-dir` 对齐） */
type DiagnosticDirKind = 'log' | 'crash' | 'data'

function warn(command: string, error: unknown): void {
  console.warn(`[diagnostics] ${command} 失败`, error)
}

// ------------------------------------------------------------ 探测类（失败给 null）

async function GET_CAPABILITIES(): Promise<Capabilities | null> {
  try {
    return await invoke<Capabilities>(CHANNELS.CAPABILITIES.PROBE)
  } catch (error) {
    warn('capabilities:probe', error)
    return null
  }
}

async function GET_DIAGNOSTICS_CAPABILITIES(): Promise<DiagnosticsCapabilities | null> {
  try {
    return await invoke<DiagnosticsCapabilities>(CHANNELS.DIAGNOSTICS.CAPABILITIES)
  } catch (error) {
    warn('diagnostics:capabilities', error)
    return null
  }
}

/**
 * 用系统文件管理器打开诊断目录，返回真正打开的路径（失败为 `null`）。
 *
 * 走 Rust 侧命令而不是前端插件：目录来源与 `diagnostics:capabilities` 同源，
 * 不会出现「显示一个路径、打开另一个路径」。
 */
async function POST_DIAGNOSTICS_OPEN_DIR(kind: DiagnosticDirKind): Promise<string | null> {
  try {
    return await invoke<string>(CHANNELS.DIAGNOSTICS.OPEN_DIR, { kind })
  } catch (error) {
    warn(`diagnostics:open-dir(${kind})`, error)
    return null
  }
}

async function GET_AGENT_CACHE_INFO(): Promise<AgentCacheStats | null> {
  try {
    return await invoke<AgentCacheStats>(CHANNELS.DIAGNOSTICS.AGENT_CACHE_INFO)
  } catch (error) {
    warn('agent_cache_info', error)
    return null
  }
}

/** 清空 Agent 缓存：只清缓存根，不动 `.cogito/plans` 与日志。返回释放的字节数。 */
async function DELETE_AGENT_CACHE(): Promise<number | null> {
  try {
    return await invoke<number>(CHANNELS.DIAGNOSTICS.AGENT_CACHE_CLEAR)
  } catch (error) {
    warn('agent_cache_clear', error)
    return null
  }
}

async function GET_BUILD_INFO(): Promise<BuildInfo | null> {
  try {
    return await invoke<BuildInfo>(CHANNELS.DIAGNOSTICS.BUILD_INFO)
  } catch (error) {
    warn('app_build_info', error)
    return null
  }
}

// ------------------------------------------------------------ 在线工具（下载 / 卸载）

/** 安装进度（Rust `tools://install-progress` 的 payload） */
interface ToolInstallProgress {
  /** 包键（`ffmpeg` / `pandoc`） */
  key: string
  /** `download` / `extract` */
  phase: 'download' | 'extract'
  received: number
  total: number
}

/**
 * 下载并安装一个在线工具。
 *
 * 错误文案由 Rust 侧拼好（HTTP 状态 / 校验不符 / 解压失败都有具体原因），调用方直接展示。
 */
function POST_TOOLS_INSTALL(key: string): Promise<void> {
  return invoke(CHANNELS.TOOLS.INSTALL, { key })
}

/** 卸载在线工具（删整个 `<tool>/` 目录；正在下载时会拒绝）。 */
function POST_TOOLS_REMOVE(key: string): Promise<void> {
  return invoke(CHANNELS.TOOLS.REMOVE, { key })
}

// ------------------------------------------------------------ 崩溃 / 日志（错误交给调用方）

/** 崩溃报告已丢弃，回执给 Rust（避免下次启动重复弹） */
function POST_DIAGNOSTICS_ACK(id: string): Promise<void> {
  return invoke(CHANNELS.DIAGNOSTICS.ACK, { id })
}

function GET_DIAGNOSTICS_PENDING<T>(): Promise<T> {
  return invoke<T>(CHANNELS.DIAGNOSTICS.PENDING)
}

/** 前端日志批量回填到 Rust 侧日志文件 */
function POST_DIAGNOSTICS_APPEND(entries: unknown): Promise<void> {
  return invoke(CHANNELS.DIAGNOSTICS.APPEND, { entries })
}

export {
  DELETE_AGENT_CACHE,
  GET_AGENT_CACHE_INFO,
  GET_BUILD_INFO,
  GET_CAPABILITIES,
  GET_DIAGNOSTICS_CAPABILITIES,
  GET_DIAGNOSTICS_PENDING,
  POST_DIAGNOSTICS_ACK,
  POST_DIAGNOSTICS_APPEND,
  POST_DIAGNOSTICS_OPEN_DIR,
  POST_TOOLS_INSTALL,
  POST_TOOLS_REMOVE
}
export type {
  AgentCacheStats,
  BuildInfo,
  Capabilities,
  DiagnosticDirKind,
  DiagnosticsCapabilities,
  ToolCapability,
  ToolInstallProgress
}
