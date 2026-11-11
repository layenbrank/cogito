/**
 * 工具风险级别（S3「沙箱统一」）：前端展示用的那一份。
 *
 * why 复刻而不是走 IPC：`risk` 是 Rust `tools::Risk` 的内部字段，只出现在
 * `/internal/tools/list` 的响应里，**不进** MCP 的 `inputSchema`（不能改 Agent
 * 可见的调用契约）；而权限设置页枚举的是 ACP 会话里的工具（goose 的
 * `tools/list`），拿不到 Rust 那份目录。所以这里按工具名推一遍——
 * 只有 `guarded` 需要人工维护，其余由 `isWriteTool` 兜底。
 */
import { isWriteTool } from '@/features/agent/approval'

type ToolRisk = 'read' | 'write' | 'guarded'

/**
 * 「写，但可能触及受保护路径」的工具：`.env` / `id_rsa*` / `*.pem` 这类文件
 * 要先由用户确认，模型才能带 `confirm: true` 重试；`.git` 则永久拒绝。
 * 判定实现在 Rust `crates/core/src/tools/workspace.rs` 的 `guard_for`。
 */
const GUARDED_TOOLS: readonly string[] = ['app_workspace_write', 'app_workspace_patch']

interface RiskMeta {
  label: string
  hint: string
  variant: 'outline' | 'secondary' | 'destructive'
}

const RISK_META: Record<ToolRisk, RiskMeta> = {
  read: {
    label: '只读',
    hint: '只读工具：不改动磁盘，也不改外部状态',
    variant: 'outline'
  },
  write: {
    label: '写入',
    hint: '会改状态；「询问审批」档下每次都要确认',
    variant: 'secondary'
  },
  guarded: {
    label: '受保护写入',
    hint: '写工作区文件：.git 永久拒绝，.env / *.pem 需用户确认',
    variant: 'destructive'
  }
}

function findToolRisk(toolName: string): ToolRisk {
  const lower = toolName.toLowerCase()
  const guarded = GUARDED_TOOLS.some(function (name) {
    // goose 会给工具名加 server 前缀（`mcp__cogito__app_workspace_write`）
    return lower === name || lower.endsWith('__' + name) || lower.endsWith(':' + name)
  })
  if (guarded) return 'guarded'
  return isWriteTool(toolName) ? 'write' : 'read'
}

export { findToolRisk, GUARDED_TOOLS, RISK_META }
export type { RiskMeta, ToolRisk }
