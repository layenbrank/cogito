/**
 * 审批规则：**这是全仓唯一允许判定「这个工具要不要人批」的代码位置**。
 *
 * 前端（审批卡片 / 设置页）与 agentd（把 `session/request_permission` 映射成
 * LangGraph `interrupt`）都必须走这里，否则两份规则一定会漂移。
 *
 * 档位本身（`agent.json` 的 per-thread 记录）留在客户端；本模块只吃「档位 + 工具名」，
 * 不碰存储、不碰 UI。
 */

import lock from './agent-tools.lock.json' with { type: 'json' }
import { isWriteTool, stripServerPrefix } from './tool-effect'

/** composer 里的审批档（与客户端 `AgentPref.approvalMode` 的字面量集合一致） */
type ApprovalMode = 'ask' | 'auto' | 'readonly'

/** goose 原生会话权限档（`session/set_config_option` 的 mode） */
type GooseMode = 'auto' | 'approve' | 'smart_approve'

/** goose `tools/permissions` 的细粒度值 */
type ToolPermissionLevel = 'always_allow' | 'ask_before' | 'never_allow'

/**
 * composer 策略 → goose 会话 mode。
 *
 * goose 默认 `auto`：permission_inspector 对所有工具直接 Allow，此时 permission.yaml
 * 的 ask_before **不会**触发审批。「询问审批」必须切到 `smart_approve` 才生效。
 */
function findGooseMode(mode: ApprovalMode): GooseMode {
  if (mode === 'auto') return 'auto'
  // ask / readonly 都靠 smart_approve 启审批通道；细粒度由 findToolPermissionLevel 区分
  return 'smart_approve'
}

/** 本地工具（cogito-mcp）：用 lock 表的成员表判定，不靠名字里的 `cogito_` 子串 */
const LOCAL_TOOLS: ReadonlySet<string> = new Set(lock.local)

/** 工具面基线：corex-mcp 的工具名（漂移由客户端自检告警，见 `agent-tools.ts`） */
const COREX_TOOLS: readonly string[] = lock.corex

/** lock 表的 schema 版本 */
const LOCK_VERSION: number = lock.version

function isLocalTool(toolName: string): boolean {
  return LOCAL_TOOLS.has(stripServerPrefix(toolName))
}

/**
 * Goose 内置黑盒 shell 的**精确**名单（绕开右栏 TerminalHub）。
 *
 * 不能像以前那样 `includes('exec' / 'shell' / 'terminal')`：那会把 `execute_javascript`、
 * `cogito_browser_*` 判成黑盒并 `never_allow` —— goose 在 smart_approve 下对 never_allow
 * 是**静默拒绝**，用户看到的是「选了询问审批，却没人问、工具直接被拒」。
 */
const OPAQUE_SHELL_NAMES: ReadonlySet<string> = new Set([
  'shell',
  'bash',
  'sh',
  'zsh',
  'pwsh',
  'powershell',
  'cmd',
  'terminal',
  'exec',
  'execute',
  'execute_command',
  'run_command',
  'kill_command',
  'process',
  'process_start'
])

/** 本地工具一律不是黑盒：`cogito_terminal_*` 是唯一允许的可见终端入口 */
function isOpaqueShellTool(toolName: string): boolean {
  if (isLocalTool(toolName)) return false
  return OPAQUE_SHELL_NAMES.has(stripServerPrefix(toolName))
}

/**
 * goose 内置文件写工具：任何审批档都是 `never_allow`。
 *
 * why：Agent 的文件写只能走 `cogito_workspace_write` / `cogito_workspace_patch`——
 * 那条路有 `.git` 永久拒绝、`.env` / `*.pem` 二次确认、写前快照；goose 自带的
 * `text_editor` / `str_replace` / `apply_patch` 直接落盘，把这些闸门全部绕过。
 */
const LEGACY_FILE_WRITE_PATTERNS = ['text_editor', 'str_replace', 'apply_patch', 'apply_diff']

function isLegacyFileWriter(toolName: string): boolean {
  const lower = stripServerPrefix(toolName)
  if (isLocalTool(lower)) return false
  return LEGACY_FILE_WRITE_PATTERNS.some(function (needle) {
    return lower.includes(needle)
  })
}

/**
 * 与档位无关的硬禁用：黑盒 shell + goose 内置写工具。
 *
 * 这张表是 `permission.yaml` **唯一**该写的内容 —— 档位本身由会话 `mode` 表达。
 */
function findHardDenyLevel(toolName: string): ToolPermissionLevel | null {
  if (isLegacyFileWriter(toolName)) return 'never_allow'
  if (isOpaqueShellTool(toolName)) return 'never_allow'
  return null
}

function findToolPermissionLevel(
  mode: ApprovalMode,
  toolName: string
): ToolPermissionLevel {
  // 无论 ask/auto/readonly：黑盒 shell 与内置写工具一律禁用，强制走本地工具
  const hard = findHardDenyLevel(toolName)
  if (hard) return hard
  if (mode === 'auto') return 'always_allow'
  if (mode === 'ask') return isWriteTool(toolName) ? 'ask_before' : 'always_allow'
  return isWriteTool(toolName) ? 'never_allow' : 'always_allow'
}

export {
  COREX_TOOLS,
  LOCAL_TOOLS,
  LOCK_VERSION,
  OPAQUE_SHELL_NAMES,
  findGooseMode,
  findHardDenyLevel,
  findToolPermissionLevel,
  isLegacyFileWriter,
  isLocalTool,
  isOpaqueShellTool
}
export type { ApprovalMode, GooseMode, ToolPermissionLevel }
