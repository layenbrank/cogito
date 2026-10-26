/**
 * 工具审批策略（对齐 Qoder「自动审批 / 询问审批」）。
 *
 * 取值落 agent.json；切换时尽量批量写 goose `tools/permissions`。
 */

import { findPref, patchPref } from '@/features/persist'
import type { ApprovalMode } from '@/features/persist'

interface ApprovalPolicyMeta {
  value: ApprovalMode
  label: string
  hint: string
}

const APPROVAL_POLICIES: readonly ApprovalPolicyMeta[] = [
  { value: 'ask', label: '询问审批', hint: '只读工具直接执行，写文件前询问' },
  { value: 'auto', label: '自动审批', hint: '不再询问，工具直接执行' },
  { value: 'readonly', label: '只读', hint: '不给写文件与执行命令的工具' }
]

const APPROVAL_MODE = 'ask'

function findApprovalPolicy(value: string) {
  return (
    APPROVAL_POLICIES.find(function (item) {
      return item.value === value
    }) ?? null
  )
}

function readApprovalMode(): ApprovalMode {
  return findPref('agent').approvalMode
}

function writeApprovalMode(mode: ApprovalMode) {
  void patchPref('agent', { approvalMode: mode })
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

/** 写动词：新增 create/append/update/save/put/set/index/rebuild/publish/run */
const WRITE_TOOL_PATTERNS = [
  'write',
  'edit',
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
  'upload'
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

export {
  APPROVAL_MODE,
  APPROVAL_POLICIES,
  READ_TOOL_PATTERNS,
  WRITE_TOOL_PATTERNS,
  classifyToolEffect,
  findApprovalPolicy,
  isWriteTool,
  readApprovalMode,
  writeApprovalMode
}
export type { ApprovalMode, ApprovalPolicyMeta, ToolEffect }
