/**
 * 工具审批策略（对齐 Qoder「自动审批 / 询问审批」）。
 *
 * 取值落 localStorage；切换时尽量批量写 goose `tools/permissions`。
 */

type ApprovalMode = 'ask' | 'auto' | 'readonly'

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
const STORAGE_KEY = 'agent.approval.mode'

function findApprovalPolicy(value: string) {
  return (
    APPROVAL_POLICIES.find(function (item) {
      return item.value === value
    }) ?? null
  )
}

function readApprovalMode(): ApprovalMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'ask' || raw === 'auto' || raw === 'readonly') return raw
  } catch (error) {
    console.warn('[approval] 读取审批模式失败，回落默认:', error)
  }
  return APPROVAL_MODE
}

function writeApprovalMode(mode: ApprovalMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch (error) {
    console.warn('[approval] 写入审批模式失败:', error)
  }
}

/** 只读档要收紧的工具名关键词（小写匹配） */
const WRITE_TOOL_NEEDLES = [
  'write',
  'edit',
  'shell',
  'bash',
  'terminal',
  'exec',
  'delete',
  'remove',
  'patch',
  'apply'
]

function isWriteTool(name: string) {
  const lower = name.toLowerCase()
  return WRITE_TOOL_NEEDLES.some(function (needle) {
    return lower.includes(needle)
  })
}

export {
  APPROVAL_MODE,
  APPROVAL_POLICIES,
  findApprovalPolicy,
  isWriteTool,
  readApprovalMode,
  writeApprovalMode
}
export type { ApprovalMode, ApprovalPolicyMeta }
