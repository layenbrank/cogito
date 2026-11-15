/**
 * 工具风险级别：**唯一实现在 `@cogito/agent-protocol/policy`**（前端与 agentd 共用）。
 *
 * 这里只做转发，保持 `@/features/agent/tool-risk` 这个既有 import 路径可用，
 * 避免调用点与测试因为目录调整而一起改动。
 */
export { GUARDED_TOOLS, RISK_META, findToolRisk } from '@cogito/agent-protocol/policy'
export type { RiskMeta, ToolRisk } from '@cogito/agent-protocol/policy'
