/**
 * 工具审批策略（对齐 Qoder「自动审批 / 询问审批」）。
 *
 * 取值落 agent.json；同步到 goose 时必须同时：
 * 1. 设会话 `mode`（`auto` 档会无条件放行，单改 permission.yaml 无效）
 * 2. 批量写 `tools/permissions` 作为细粒度覆盖
 */

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

/** 工具效果分类（写动词优先 / fail-closed）已下沉到 `@cogito/agent-protocol/policy`。 */

/** 审批规则（goose mode / 硬禁用 / 细粒度权限）已下沉到 `@cogito/agent-protocol/policy`。 */

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
  clearApprovalModeFor,
  findApprovalPolicy,
  readApprovalMode,
  readApprovalModeFor,
  subscribeApproval,
  writeApprovalMode,
  writeApprovalModeFor
}
// 审批 / 风险规则的**唯一实现**在 @cogito/agent-protocol/policy（前端与 agentd 共用）；
// 这里只转发，保持既有 import 路径不变。
export {
  classifyToolEffect,
  EXACT_FILE_WRITE_NAMES,
  findGooseMode,
  findHardDenyLevel,
  isLegacyFileWriter,
  isLocalTool,
  isOpaqueShellTool,
  isWriteTool,
  listHardDenyToolNames,
  stripServerPrefix
} from '@cogito/agent-protocol/policy'
export type { GooseMode, ToolEffect } from '@cogito/agent-protocol/policy'
export type { ApprovalMode }
export type { ApprovalPolicyMeta }
