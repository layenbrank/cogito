/**
 * Agent 工具面基线（`agent-tools.lock.json`）与自检。
 *
 * why：corex-mcp 是随包外部二进制，工具名随版本漂移；提示词里写错一个名字，
 * 模型就会「找不到工具」然后开始臆造。启动/建会话时对一次 tools/list，
 * 不一致要响亮告警，而不是让失败发生在用户点下发送之后。
 *
 * 匹配规则：goose 会按 server 给工具名加前缀（`mcp_x__` / `server__`），
 * 所以按「词边界后缀」匹配，避免 `corex_action` 误命中 `corex_actions`。
 */
import lock from './agent-tools.lock.json'

type AgentToolServer = 'corex' | 'local'

interface ToolVerification {
  server: AgentToolServer
  expected: readonly string[]
  present: readonly string[]
  missing: readonly string[]
  unexpected: readonly string[]
}

function isBoundary(name: string, expected: string): boolean {
  if (!name.endsWith(expected)) return false
  const before = name[name.length - expected.length - 1]
  return before === undefined || before === '_' || before === '-' || before === ':'
}

function matchesTool(name: string, expected: string): boolean {
  const normalized = name.toLowerCase()
  return normalized === expected.toLowerCase() || isBoundary(normalized, expected.toLowerCase())
}

function findServerOf(name: string): AgentToolServer | null {
  const normalized = name.toLowerCase()
  if (normalized.includes('corex')) return 'corex'
  if (normalized.includes('app_')) return 'local'
  return null
}

function findExpected(server: AgentToolServer): readonly string[] {
  return server === 'corex' ? lock.corex : lock.local
}

function verifyAgentTools(names: readonly string[], server: AgentToolServer): ToolVerification {
  const expected = findExpected(server)
  const present = expected.filter(function (tool) {
    return names.some(function (name) {
      return matchesTool(name, tool)
    })
  })
  const missing = expected.filter(function (tool) {
    return !present.includes(tool)
  })
  const unexpected = names.filter(function (name) {
    return findServerOf(name) === server && !expected.some(function (tool) {
      return matchesTool(name, tool)
    })
  })
  return { server, expected, present, missing, unexpected }
}

/** 本地工具（app_*）尚未全部落地时，自检只在注入该 server 后启用 */
function isLocalToolsLocked(): boolean {
  return lock.local.length > 0
}

export { findServerOf, isLocalToolsLocked, matchesTool, verifyAgentTools }
export type { AgentToolServer, ToolVerification }
