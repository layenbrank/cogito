/**
 * 工具审批策略（对齐 Qoder「自动审批 / 询问审批」）。
 *
 * 取值落 agent.json；同步到 goose 时必须同时：
 * 1. 设会话 `mode`（`auto` 档会无条件放行，单改 permission.yaml 无效）
 * 2. 批量写 `tools/permissions` 作为细粒度覆盖
 */

import type { ToolPermissionLevel } from '@/features/agent/acp/goose-providers'
import { notifyScope, readScopeThread, subscribeScope } from '@/features/agent/thread-scope'
import { findPref, patchPref } from '@/features/persist'
import type { ApprovalMode } from '@/features/persist'

import lock from './agent-tools.lock.json'

interface ApprovalPolicyMeta {
  value: ApprovalMode
  label: string
  hint: string
  /** lucide 图标名（composer 触发器 / 菜单行） */
  icon: string
}

/** goose 原生会话权限档（`session/set_config_option` 的 mode） */
type GooseMode = 'auto' | 'approve' | 'smart_approve'

/**
 * 审批档总表：**键顺序即菜单顺序**（询问 → 自动 → 只读）。
 * 新增档位只改这里，`APPROVAL_POLICIES` 与 `findApprovalPolicy` 自动跟上。
 */
const APPROVAL_META: Record<ApprovalMode, ApprovalPolicyMeta> = {
  ask: {
    value: 'ask',
    label: '询问审批',
    hint: '写文件、执行命令等操作前始终询问；只读工具直接放行',
    icon: 'lucide:shield'
  },
  auto: {
    value: 'auto',
    label: '自动审批',
    // 产品真相：goose `auto` 会无条件放行，不是「仅风险时询问」
    hint: '不再询问，工具直接执行',
    icon: 'lucide:circle-play'
  },
  readonly: {
    value: 'readonly',
    label: '只读',
    hint: '仅允许只读工具，禁止写文件与执行命令',
    icon: 'lucide:book-lock'
  }
}

const APPROVAL_MODE = 'ask'

/** 菜单展示顺序 = `APPROVAL_META` 的键顺序 */
const APPROVAL_POLICIES: readonly ApprovalPolicyMeta[] = Object.values(APPROVAL_META)

function isApprovalMode(value: string): value is ApprovalMode {
  return Object.hasOwn(APPROVAL_META, value)
}

function findApprovalPolicy(value: string) {
  return isApprovalMode(value) ? APPROVAL_META[value] : null
}

function readApprovalMode(): ApprovalMode {
  const threadID = readScopeThread()
  // 会话级：有记录用记录；**新会话没有记录就回落到默认值** —— 不沿用上一个会话的选择
  if (!threadID) return pendingDefaultApproval ?? findPref('agent').approvalMode
  return readApprovalModeFor(threadID)
}

/**
 * 还没有会话时改的「下一个新会话的默认值」。
 *
 * 与下面的 `pendingApproval` 同理：先写内存（UI 立即正确），落盘完成后清掉。
 */
let pendingDefaultApproval: ApprovalMode | null = null

/**
 * 最近一次写入的档位：内存里先落地，**UI 与后台续跑都要立刻看到**。
 *
 * `patchPref` 第一个 `await` 把 cache 更新推到微任务，而 `notifyScope()` 是同步的
 * —— 直接 `void patchPref(...)` 再 `notifyScope()` 只会让订阅者读到上一次的值，
 * 界面就停在旧档（第一次点「自动审批」，开关还显示「询问审批」）。
 * 所以先写这里、同步通知，落盘异步进行。
 *
 * `null` = 明确清除（回落到全局默认），与「没有记录」区分开。
 * 落盘完成后条目会被删掉（那时 `agent.json` 的 cache 已经一致）。
 */
const pendingApproval = new Map<string, ApprovalMode | null>()

/** 一次性任务会话（`automation-<runId>`）的审批档只放内存，不落 `agent.json` */
function isTransientThread(threadID: string): boolean {
  return threadID.startsWith('automation-')
}

/**
 * 落盘串行化：连点两次审批档时，**后点的必须后落盘**。
 *
 * 以前两次 `patchPref` 并发，谁先回来谁算数：界面显示第二次的档位，库里留的却是
 * 第一次的，重启后又变回去。串行化后，每次写入在轮到自己时才读偏好，能看见前一次的结果。
 */
let approvalWriteQueue: Promise<void> = Promise.resolve()

function enqueueApprovalWrite(build: () => Promise<void>): void {
  const next = approvalWriteQueue.then(build, build)
  // 前一次失败不该堵住后面的写入
  approvalWriteQueue = next.catch(function () {
    return undefined
  })
}

/** 按指定会话读（目标推进的后台续跑不在当前 UI 线程上下文里） */
function readApprovalModeFor(threadID: string): ApprovalMode {
  const pending = pendingApproval.get(threadID)
  const pref = findPref('agent')
  if (pending !== undefined) return pending ?? pref.approvalMode
  return pref.approvalByThread[threadID] ?? pref.approvalMode
}

/** 按指定会话写：多会话并发推进时不能互相污染 */
function writeApprovalModeFor(threadID: string, mode: ApprovalMode) {
  if (pendingApproval.get(threadID) === mode) return
  pendingApproval.set(threadID, mode)
  notifyScope()
  // 一次性任务会话：档位只放内存，别为它写盘
  if (isTransientThread(threadID)) return
  enqueueApprovalWrite(function () {
    const pref = findPref('agent')
    return patchPref('agent', {
      approvalByThread: { ...pref.approvalByThread, [threadID]: mode }
    }).then(function () {
      // 期间又被改成别的档就留着，别把更新的值清掉
      if (pendingApproval.get(threadID) === mode) pendingApproval.delete(threadID)
    })
  })
}

/** 清除会话偏好（回落全局默认）；一次性任务会话从来没落过盘 */
function clearApprovalModeFor(threadID: string) {
  if (pendingApproval.get(threadID) === null) return
  pendingApproval.set(threadID, null)
  notifyScope()
  if (isTransientThread(threadID)) return
  const pref = findPref('agent')
  if (!(threadID in pref.approvalByThread)) {
    pendingApproval.delete(threadID)
    return
  }
  enqueueApprovalWrite(function () {
    // 轮到自己时再读：前一次写入可能刚把这个会话的记录改了
    const current = findPref('agent')
    const next = { ...current.approvalByThread }
    delete next[threadID]
    return patchPref('agent', { approvalByThread: next }).then(function () {
      if (pendingApproval.get(threadID) === null) pendingApproval.delete(threadID)
    })
  })
}

function writeApprovalMode(mode: ApprovalMode) {
  const threadID = readScopeThread()
  if (!threadID) {
    // 还没有会话（首条消息发出前）：只改「下一个新会话」的默认值
    pendingDefaultApproval = mode
    enqueueApprovalWrite(function () {
      return patchPref('agent', { approvalMode: mode }).then(function () {
        if (pendingDefaultApproval === mode) pendingDefaultApproval = null
      })
    })
    notifyScope()
    return
  }
  writeApprovalModeFor(threadID, mode)
}

/** 供 `useSyncExternalStore` 订阅：切会话 / 改审批档都会触发 */
function subscribeApproval(listener: () => void): () => void {
  return subscribeScope(listener)
}

/**
 * 工具效果分类。
 *
 * 之前用一串关键词做 includes，导致 `calendar.create` / `memo.append` 这类
 * 名字既不含 write 也不含 edit，被当成只读工具直接放行。现在改成：
 * 先认显式读工具 → 再按写动词 → 本地 `cogito_*` 未知一律按写（失败关闭）→
 * 其余保持旧行为（按读处理）。
 */
type ToolEffect = 'read' | 'write'

/** 只读动词（按 `_` 分词后精确匹配）：宁可多列，避免把 read/search 误判成写 */
const READ_VERBS: ReadonlySet<string> = new Set([
  'read',
  'list',
  'search',
  'find',
  'inspect',
  'validate',
  'preview',
  'query',
  'recall',
  'catalog',
  'fetch',
  'status',
  'info',
  'glob',
  'grep',
  'lint',
  'action',
  'actions',
  'directive',
  'directives',
  'open',
  'wait',
  'screenshot',
  'network',
  'symbols',
  'outline',
  'refs',
  'impact',
  'graph',
  'result'
])

/** 写动词：含 goose developer 的 text_editor / str_replace 等 */
const WRITE_VERBS: ReadonlySet<string> = new Set([
  'write',
  'edit',
  'text_editor',
  'str_replace',
  'replace',
  'patch',
  'apply',
  'shell',
  'bash',
  'terminal',
  'exec',
  'execute',
  'run',
  'delete',
  'remove',
  'save',
  'create',
  'append',
  'update',
  'set',
  'import',
  'rebuild',
  'publish',
  'invoke',
  'kill',
  'install',
  'upload',
  'mkdir',
  'move',
  'rename',
  'copy',
  'act',
  'intercept',
  'device',
  'spawn',
  'ingest',
  'send',
  'push'
])

/**
 * 工具效果：**写动词优先**，读动词次之，认不出来一律按写（fail-closed）。
 *
 * 旧实现有两个真缺陷：
 * 1. 读表用 `includes` 先判 —— `budget` / `target` / `widget` / `transaction` 里的
 *    `get`、`action` 会把写工具判成读（第三方 MCP 的 `server` 名也会污染全量工具）；
 * 2. 兜底是「非 `cogito_` 按读」—— 接入的任意 MCP 写工具（`push_files` / `send_message`）
 *    在「询问」档不问、「只读」档不禁、计划模式也拦不住。
 */
function classifyToolEffect(name: string): ToolEffect {
  const tokens = stripServerPrefix(name)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(function (token) {
      return token.length > 0
    })
  if (tokens.some(function (token) { return WRITE_VERBS.has(token) })) return 'write'
  if (tokens.some(function (token) { return READ_VERBS.has(token) })) return 'read'
  return 'write'
}

function isWriteTool(name: string) {
  return classifyToolEffect(name) === 'write'
}

/**
 * composer 策略 → goose 会话 mode。
 *
 * goose 默认 `auto`：permission_inspector 对所有工具直接 Allow，
 * 此时 permission.yaml 的 ask_before **不会**触发审批。
 * 「询问审批」必须切到 `smart_approve`（只读写分流）才生效。
 */
function findGooseMode(mode: ApprovalMode): GooseMode {
  if (mode === 'auto') return 'auto'
  // ask / readonly 都靠 smart_approve 启审批通道；细粒度由 findToolPermissionLevel 区分
  return 'smart_approve'
}

/**
 * Goose 内置黑盒 shell（绕开右栏 TerminalHub）。
 * `cogito_terminal_*` 除外 —— 那是唯一允许的可见终端入口。
 */
/**
 * 工具名 → 去掉扩展前缀后的本体：`local__cogito_terminal_run` / `mcp__local__cogito_terminal_run`
 * → `cogito_terminal_run`。
 *
 * goose 会按 server 给工具名加前缀，所以判定/展示/标签全部先剥一层再用。
 */
function stripServerPrefix(toolName: string): string {
  const lower = toolName.trim().toLowerCase()
  const sep = lower.lastIndexOf('__')
  return sep >= 0 ? lower.slice(sep + 2) : lower
}

/** 本地工具（cogito-mcp）：用 lock 表的成员表判定，不再靠名字里的 `cogito_` 子串 */
const LOCAL_TOOLS: ReadonlySet<string> = new Set(lock.local)

function isLocalTool(toolName: string): boolean {
  return LOCAL_TOOLS.has(stripServerPrefix(toolName))
}

/**
 * Goose 内置黑盒 shell 的**精确**名单（绕开右栏 TerminalHub）。
 *
 * 这里必须按名字精确匹配，不能像以前那样 `includes('exec' / 'shell' / 'terminal')`：
 * 那会把 `execute_javascript`（名字里有 exec）、`cogito_browser_*` 这类正常工具判成黑盒
 * shell 并直接 `never_allow` —— goose 在 smart_approve 下对 never_allow 是**静默拒绝**，
 * 用户看到的就是「选了询问审批，却没人问我、工具直接被拒」。
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
 * goose 内置文件写工具（S3「沙箱统一」）：任何审批档都是 `never_allow`。
 *
 * why：Agent 的文件写只能走 `cogito_workspace_write` / `cogito_workspace_patch`——
 * 那条路有 `.git` 永久拒绝、`.env` / `*.pem` 二次确认、写前快照，以及
 * 「先 canonicalize 再判授权集」的符号链接防御。goose 自带的 `text_editor` /
 * `str_replace` / `apply_patch` 直接落盘，把这些闸门全部绕过；而且 `auto` 档
 * 会无条件放行，靠「询问」也拦不住。所以只能在审批层硬禁用。
 *
 * 本地 `cogito_*` 工具是唯一允许的写入口，自身已有 guard，不受这条限制。
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
 * 以前按档位把整张工具表覆写一遍，结果多会话互相污染（A 选「询问」，B 跑一次自动
 * 就把 A 的工具权限改成 `always_allow`）。
 */
function findHardDenyLevel(toolName: string): ToolPermissionLevel | null {
  if (isLegacyFileWriter(toolName)) return 'never_allow'
  if (isOpaqueShellTool(toolName)) return 'never_allow'
  return null
}

function findToolPermissionLevel(mode: ApprovalMode, toolName: string): ToolPermissionLevel {
  // 无论 ask/auto/readonly：黑盒 shell 与内置写工具一律禁用，强制走本地工具
  const hard = findHardDenyLevel(toolName)
  if (hard) return hard
  if (mode === 'auto') return 'always_allow'
  if (mode === 'ask') return isWriteTool(toolName) ? 'ask_before' : 'always_allow'
  return isWriteTool(toolName) ? 'never_allow' : 'always_allow'
}

/**
 * 只放内存的**运行期**审批覆盖（任务 / 一次性流程用）。
 *
 * 与 `writeApprovalModeFor` 的区别：不写 `agent.json`。任务把用户会话的审批档改成
 * 任务档再清掉的行为，会静默重置用户自己的选择；运行期覆盖在 `clear` 后自然回落。
 */
function applyTransientApproval(threadID: string, mode: ApprovalMode): void {
  const id = threadID.trim()
  if (!id) return
  pendingApproval.set(id, mode)
  notifyScope()
}

export {
  APPROVAL_MODE,
  APPROVAL_POLICIES,
  applyTransientApproval,
  classifyToolEffect,
  clearApprovalModeFor,
  findApprovalPolicy,
  findGooseMode,
  findHardDenyLevel,
  findToolPermissionLevel,
  isLegacyFileWriter,
  isLocalTool,
  isOpaqueShellTool,
  isWriteTool,
  readApprovalMode,
  readApprovalModeFor,
  stripServerPrefix,
  subscribeApproval,
  writeApprovalMode,
  writeApprovalModeFor
}
export type { ApprovalMode, ApprovalPolicyMeta, GooseMode, ToolEffect }
