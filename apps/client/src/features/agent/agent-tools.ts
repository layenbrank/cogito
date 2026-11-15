/**
 * 工具面基线：`@cogito/agent-protocol/policy`（与审批判定同一份 lock 表，避免双轨）。
 *
 * why：corex-mcp 是随包外部二进制，工具名随版本漂移；提示词里写错一个名字，
 * 模型就会「找不到工具」然后开始臆造。启动/建会话时对一次 tools/list，
 * 不一致要响亮告警，而不是让失败发生在用户点下发送之后。
 *
 * 匹配规则：goose 会按 server 给工具名加前缀（`local__cogito_workspace_read`，
 * 旧形态还有 `mcp__<server>__`），所以一律先剥前缀再按成员表判定。
 */
import { COREX_TOOLS, LOCAL_TOOLS } from '@cogito/agent-protocol/policy'

type AgentToolServer = 'corex' | 'local'

/** 已挂的两个 server 注册名（与 `acp/session.ts` 的注入名单一致） */
const SERVER_NAMES: readonly AgentToolServer[] = ['corex', 'local']

/** 每个 server 的工具名前缀：剥掉 `<server>__` 之后仍能认出来是谁家的 */
const SERVER_BRANDS: Readonly<Record<AgentToolServer, readonly string[]>> = {
  corex: ['corex_'],
  local: ['cogito_']
}

interface ToolVerification {
  server: AgentToolServer
  expected: readonly string[]
  present: readonly string[]
  missing: readonly string[]
  unexpected: readonly string[]
}

/** 工具全名 → 本体：`local__cogito_terminal_run` / `mcp__local__cogito_terminal_run` → `cogito_terminal_run` */
function stripPrefix(name: string): string {
  const lower = name.trim().toLowerCase()
  const sep = lower.lastIndexOf('__')
  return sep >= 0 ? lower.slice(sep + 2) : lower
}

function findExpected(server: AgentToolServer): readonly string[] {
  return server === 'corex' ? COREX_TOOLS : Array.from(LOCAL_TOOLS)
}

/**
 * 工具属于哪个 server：先看 `<server>__` 前缀，再看本体是否在成员表里。
 *
 * 只看成员表会把「同一 server 下新增/漂移的工具」判成「不属于任何人」，
 * 那样 `unexpected` 永远不会命中，工具面漂移就查不出来了。
 */
function findServerOf(name: string): AgentToolServer | null {
  const lower = name.trim().toLowerCase()
  const sep = lower.lastIndexOf('__')
  const prefix = sep >= 0 ? lower.slice(0, sep) : ''
  // `mcp__local` 这种双层前缀：取最后一段作为 server 名（没有 `__` 时就是它自己）
  const inner = prefix.lastIndexOf('__')
  const tail = prefix === '' ? '' : inner >= 0 ? prefix.slice(inner + 2) : prefix
  const named = SERVER_NAMES.find(function (server) {
    return server === tail
  })
  if (named) return named
  const base = stripPrefix(name)
  const member = SERVER_NAMES.find(function (server) {
    return findExpected(server).includes(base)
  })
  if (member) return member
  // 成员表里没有（漂移 / 新工具）：按品牌前缀归给对应 server，好让 `unexpected` 报出来
  return (
    SERVER_NAMES.find(function (server) {
      return SERVER_BRANDS[server].some(function (brand) {
        return base.startsWith(brand)
      })
    }) ?? null
  )
}

/**
 * 本体是否等于期望名：整名相等，或「词边界后缀」相等。
 *
 * 后缀这条不能少：goose 不同版本拼前缀的写法不止一种（`local__x` / `mcp_corex-mcp_x`），
 * 统一剥 `__` 剥不干净的就得靠边界后缀；同时它仍然避免 `corex_action` 误命中 `corex_actions`。
 */
function matchesTool(name: string, expected: string): boolean {
  const lower = name.trim().toLowerCase()
  const target = expected.toLowerCase()
  if (lower === target || stripPrefix(lower) === target) return true
  if (!lower.endsWith(target)) return false
  const before = lower[lower.length - target.length - 1]
  return before === '_' || before === '-' || before === ':'
}

function verifyAgentTools(names: readonly string[], server: AgentToolServer): ToolVerification {
  const expected = findExpected(server)
  const present = expected.filter(function (tool) {
    return names.some(function (name) {
      return matchesTool(name, tool)
    })
  })
  const presentSet = new Set(present)
  const missing = expected.filter(function (tool) {
    return !presentSet.has(tool)
  })
  const unexpected = names.filter(function (name) {
    return findServerOf(name) === server && !expected.some(function (tool) {
      return matchesTool(name, tool)
    })
  })
  return { server, expected, present, missing, unexpected }
}

/** 本地工具（`cogito_*`）尚未全部落地时，自检只在注入该 server 后启用 */
function isLocalToolsLocked(): boolean {
  return LOCAL_TOOLS.size > 0
}

export { findServerOf, isLocalToolsLocked, matchesTool, verifyAgentTools }
export type { AgentToolServer, ToolVerification }
