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
  const pref = findPref('agent')
  const threadID = readScopeThread()
  // 会话级：有记录用记录；**新会话没有记录就回落到默认值** —— 不沿用上一个会话的选择
  if (threadID) return pref.approvalByThread[threadID] ?? pref.approvalMode
  return pref.approvalMode
}

/** 按指定会话读（目标推进的后台续跑不在当前 UI 线程上下文里） */
function readApprovalModeFor(threadID: string): ApprovalMode {
  const pref = findPref('agent')
  return pref.approvalByThread[threadID] ?? pref.approvalMode
}

/** 按指定会话写：多会话并发推进时不能互相污染 */
function writeApprovalModeFor(threadID: string, mode: ApprovalMode) {
  const pref = findPref('agent')
  void patchPref('agent', {
    approvalByThread: { ...pref.approvalByThread, [threadID]: mode }
  })
  notifyScope()
}

function writeApprovalMode(mode: ApprovalMode) {
  const pref = findPref('agent')
  const threadID = readScopeThread()
  if (!threadID) {
    // 还没有会话（首条消息发出前）：只改「下一个新会话」的默认值
    void patchPref('agent', { approvalMode: mode })
    notifyScope()
    return
  }
  void patchPref('agent', {
    approvalByThread: { ...pref.approvalByThread, [threadID]: mode }
  })
  notifyScope()
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

/** 按 composer 审批策略映射 goose 工具权限档 */
function findToolPermissionLevel(mode: ApprovalMode, toolName: string): ToolPermissionLevel {
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
  findApprovalPolicy,
  findGooseMode,
  findToolPermissionLevel,
  isWriteTool,
  readApprovalMode,
  readApprovalModeFor,
  subscribeApproval,
  writeApprovalMode,
  writeApprovalModeFor
}
export type { ApprovalMode, ApprovalPolicyMeta, GooseMode, ToolEffect }
