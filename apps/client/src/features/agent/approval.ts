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

interface ApprovalPolicyMeta {
  value: ApprovalMode
  label: string
  hint: string
  /** lucide 图标名（composer 触发器 / 菜单行） */
  icon: string
}

/** goose 原生会话权限档（`session/set_config_option` 的 mode） */
type GooseMode = 'auto' | 'approve' | 'smart_approve' | 'chat'

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
  const pref = findPref('agent')
  void patchPref('agent', {
    approvalByThread: { ...pref.approvalByThread, [threadID]: mode }
  }).then(function () {
    // 期间又被改成别的档就留着，别把更新的值清掉
    if (pendingApproval.get(threadID) === mode) pendingApproval.delete(threadID)
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
  const next = { ...pref.approvalByThread }
  delete next[threadID]
  void patchPref('agent', { approvalByThread: next }).then(function () {
    if (pendingApproval.get(threadID) === null) pendingApproval.delete(threadID)
  })
}

function writeApprovalMode(mode: ApprovalMode) {
  const threadID = readScopeThread()
  if (!threadID) {
    // 还没有会话（首条消息发出前）：只改「下一个新会话」的默认值
    pendingDefaultApproval = mode
    void patchPref('agent', { approvalMode: mode }).then(function () {
      if (pendingDefaultApproval === mode) pendingDefaultApproval = null
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
 * 先认显式读工具 → 再按写动词 → 本地 `app_*` 未知一律按写（失败关闭）→
 * 其余保持旧行为（按读处理）。
 */
type ToolEffect = 'read' | 'write'

/** 只读动词：宁可多列，避免把 read/search 误判成写 */
const READ_TOOL_PATTERNS = [
  'read',
  'list',
  'get',
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
  'directives'
]

/** 写动词：含 goose developer 的 text_editor / str_replace 等 */
const WRITE_TOOL_PATTERNS = [
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
  'delete',
  'remove',
  'save',
  'create',
  'append',
  'update',
  'put',
  'set',
  'import',
  'index',
  'rebuild',
  'publish',
  'run',
  'invoke',
  'kill',
  'install',
  'upload',
  'mkdir',
  'move',
  'rename',
  'copy'
]

function classifyToolEffect(name: string): ToolEffect {
  const lower = name.toLowerCase()
  if (
    READ_TOOL_PATTERNS.some(function (needle) {
      return lower.includes(needle)
    })
  ) {
    return 'read'
  }
  if (
    WRITE_TOOL_PATTERNS.some(function (needle) {
      return lower.includes(needle)
    })
  ) {
    return 'write'
  }
  // 本地工具未知时按写处理（失败关闭）；goose 内置保持旧行为（按读）
  return lower.includes('app_') ? 'write' : 'read'
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
 * `app_terminal_*` 除外 —— 那是唯一允许的可见终端入口。
 */
function isOpaqueShellTool(toolName: string): boolean {
  const lower = toolName.toLowerCase()
  if (lower.includes('app_terminal')) return false
  return (
    lower === 'shell' ||
    lower === 'bash' ||
    lower === 'terminal' ||
    lower.includes('shell') ||
    lower.includes('bash') ||
    lower.includes('terminal') ||
    lower.includes('exec')
  )
}

/**
 * goose 内置文件写工具（S3「沙箱统一」）：任何审批档都是 `never_allow`。
 *
 * why：Agent 的文件写只能走 `app_workspace_write` / `app_workspace_patch`——
 * 那条路有 `.git` 永久拒绝、`.env` / `*.pem` 二次确认、写前快照，以及
 * 「先 canonicalize 再判授权集」的符号链接防御。goose 自带的 `text_editor` /
 * `str_replace` / `apply_patch` 直接落盘，把这些闸门全部绕过；而且 `auto` 档
 * 会无条件放行，靠「询问」也拦不住。所以只能在审批层硬禁用。
 *
 * 本地 `app_*` 工具是唯一允许的写入口，自身已有 guard，不受这条限制。
 */
const LEGACY_FILE_WRITE_PATTERNS = ['text_editor', 'str_replace', 'apply_patch', 'apply_diff']

function isLegacyFileWriter(toolName: string): boolean {
  const lower = toolName.toLowerCase()
  if (lower.includes('app_')) return false
  return LEGACY_FILE_WRITE_PATTERNS.some(function (needle) {
    return lower.includes(needle)
  })
}

function findToolPermissionLevel(mode: ApprovalMode, toolName: string): ToolPermissionLevel {
  // 无论 ask/auto/readonly：黑盒 shell 一律禁用，强制走 app_terminal_*
  if (isLegacyFileWriter(toolName)) return 'never_allow'
  if (isOpaqueShellTool(toolName)) return 'never_allow'
  if (mode === 'auto') return 'always_allow'
  if (mode === 'ask') return isWriteTool(toolName) ? 'ask_before' : 'always_allow'
  return isWriteTool(toolName) ? 'never_allow' : 'always_allow'
}

export {
  APPROVAL_MODE,
  APPROVAL_POLICIES,
  READ_TOOL_PATTERNS,
  WRITE_TOOL_PATTERNS,
  classifyToolEffect,
  clearApprovalModeFor,
  findApprovalPolicy,
  findGooseMode,
  findToolPermissionLevel,
  isLegacyFileWriter,
  isOpaqueShellTool,
  isWriteTool,
  readApprovalMode,
  readApprovalModeFor,
  subscribeApproval,
  writeApprovalMode,
  writeApprovalModeFor
}
export type { ApprovalMode, ApprovalPolicyMeta, GooseMode, ToolEffect }
