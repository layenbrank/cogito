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
import { stripServerPrefix } from './tool-effect'

/** composer 里的审批档（与客户端 `AgentPref.approvalMode` 的字面量集合一致） */
type ApprovalMode = 'ask' | 'auto' | 'readonly'

/** goose 原生会话权限档（`session/set_config_option` 的 mode） */
type GooseMode = 'auto' | 'approve' | 'smart_approve'

/** goose `tools/permissions` 的细粒度值 */
type ToolPermissionLevel = 'always_allow' | 'ask_before' | 'never_allow'

/**
 * composer 策略 → goose 会话 mode。
 *
 * - `auto` → `auto`：goose 无条件放行，**硬禁用靠 permission.yaml 拦**，这是全仓唯一
 *   一个「不写 yaml 就拦不住」的档，所以 agentd 每个会话都必须先同步一次硬禁用。
 * - `ask` → `smart_approve`：goose 把带 `read_only_hint` 的工具分类，写工具必定要走审批；
 *   前端在收到审批后不再额外判断（用户就是想被问）。
 * - `readonly` → `approve`：**不用 smart_approve**。smart_approve 对没有 annotation
 *   的工具会请模型自己判「这个调用是不是只读的」，而 readonly 档的承诺是「写工具一定
 *   不执行」—— 不能把这条承诺押在模型判断上。`approve` 下所有工具都先问，前端再把
 *   只读的自动放行、写的直接拒（见 `decideApproval`），既有确定性又不打扰用户。
 */
function findGooseMode(mode: ApprovalMode): GooseMode {
  if (mode === 'auto') return 'auto'
  if (mode === 'readonly') return 'approve'
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
 * goose developer 扩展的**精确**写工具名。
 *
 * 为什么必须单独一张精确表：这几个名字太短，只能等值匹配。`todo__todo_write` 剥前缀后是
 * `todo_write`，含 `write` 子串——用子串匹配会把 todo 工具一起硬禁用，用户看到的是
 * 「选了询问审批，todo 却直接被拒」。
 */
const EXACT_FILE_WRITE_NAMES: ReadonlySet<string> = new Set(['write', 'edit'])

/**
 * goose 内置文件写工具：任何审批档都是 `never_allow`。
 *
 * why：Agent 的文件写只能走 `cogito_workspace_write` / `cogito_workspace_patch`——
 * 那条路有 `.git` 永久拒绝、`.env` / `*.pem` 二次确认、写前快照；goose 自带的
 * `write` / `edit` / `text_editor` / `str_replace` / `apply_patch` 直接落盘，把这些闸门
 * 全部绕过。漏掉 `write` / `edit` 的后果实测过：`permission.yaml` 的 user 段里一条
 * `write: always_allow` 就能让整条闸门永久失效（goose 只做精确匹配，通配符不生效）。
 */
const LEGACY_FILE_WRITE_PATTERNS = ['text_editor', 'str_replace', 'apply_patch', 'apply_diff']

function isLegacyFileWriter(toolName: string): boolean {
  const lower = stripServerPrefix(toolName)
  if (isLocalTool(lower)) return false
  if (EXACT_FILE_WRITE_NAMES.has(lower)) return true
  return LEGACY_FILE_WRITE_PATTERNS.some(function (needle) {
    return lower.includes(needle)
  })
}

/**
 * 与档位无关的硬禁用：黑盒 shell + goose 内置写工具。
 *
 * 两者都是 `never_allow`，与 ask / auto / readonly 无关 —— 「自动审批」只意味着
 * 不再逐次询问 cogito 的工具，不意味着允许绕开右栏终端与工作区写闸门。
 */
function findHardDenyLevel(toolName: string): ToolPermissionLevel | null {
  if (isLegacyFileWriter(toolName)) return 'never_allow'
  if (isOpaqueShellTool(toolName)) return 'never_allow'
  return null
}

/**
 * 从一份工具清单里挑出必须硬禁用的那些。
 *
 * 唯一的调用方是 agentd 的会话初始化：硬禁用必须**由每个 goose 会话自己保证**，
 * 不能靠「用户点过审批档下拉」。旧实现把它挂在档位切换上，于是全新会话在用户碰
 * 那个下拉之前根本没有任何 `never_allow` —— 黑盒 shell 在 `auto` 档下直通。
 *
 * 返回去重后的工具名（goose 的 `tools/permissions/set` 按精确名写）。
 */
function listHardDenyToolNames(toolNames: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const name of toolNames) {
    if (findHardDenyLevel(name) === null) continue
    seen.add(name)
  }
  return Array.from(seen)
}

/**
 * goose 拒绝工具时的固定文案（`crates/goose/src/agents/tool_execution.rs` 的
 * `DECLINED_RESPONSE`）。
 *
 * 完整原文还有后半句 `DO NOT attempt to call this tool again. …`，所以只比对开头。
 */
const POLICY_DENIED_PREFIX = 'The user has declined to run this tool.'

/**
 * 这条工具结果是不是「被策略拒的」而不是「用户真的点了拒绝」。
 *
 * goose 把两条路径压成同一句话（`ApprovalDecision::Deny { reason: DECLINED_RESPONSE }`
 * 同时覆盖用户点拒绝和 `never_allow` 命中），所以模型只能猜到「用户拒绝」—— 实测过
 * 一次对话里 agent 反复追问「你是不是点了拒绝」，排查方向完全跑偏。
 *
 * 这里只把文案识别出来；到底是「设计禁用」还是「权限文件里的手动偏好」，
 * 由调用方结合 `findHardDenyLevel` 判断（见 `findHardDenyReplacement`）。
 */
function isPolicyDeniedText(text: string): boolean {
  return text.includes(POLICY_DENIED_PREFIX)
}

/**
 * 硬禁用工具的替代入口（告诉用户与模型「改用哪个」）。
 *
 * 非硬禁用返回 `null` —— 那种情况是 `permission.yaml` 的手动偏好或档位拦的，
 * 该引导用户去设置页看，而不是换工具。
 */
function findHardDenyReplacement(toolName: string): string | null {
  if (isOpaqueShellTool(toolName)) return 'cogito_terminal_run'
  if (isLegacyFileWriter(toolName)) return 'cogito_workspace_write / cogito_workspace_patch'
  return null
}

export {
  COREX_TOOLS,
  EXACT_FILE_WRITE_NAMES,
  LOCAL_TOOLS,
  LOCK_VERSION,
  OPAQUE_SHELL_NAMES,
  POLICY_DENIED_PREFIX,
  findGooseMode,
  findHardDenyLevel,
  findHardDenyReplacement,
  isLegacyFileWriter,
  isLocalTool,
  isOpaqueShellTool,
  isPolicyDeniedText,
  listHardDenyToolNames
}
export type { ApprovalMode, GooseMode, ToolPermissionLevel }
