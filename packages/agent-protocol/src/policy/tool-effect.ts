/**
 * 工具效果分类：**写动词优先**，读动词次之，认不出来一律按写（fail-closed）。
 *
 * why 不用 `includes`：`budget` / `target` / `widget` / `transaction` 里的 `get`、`action`
 * 会把写工具判成读；第三方 MCP 的 `push_files` / `send_message` 会被当成只读直接放行。
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
 * 工具名 → 去掉扩展前缀后的本体：`local__cogito_terminal_run` / `mcp__local__cogito_terminal_run`
 * → `cogito_terminal_run`。goose 会按 server 给工具名加前缀，判定/展示都先剥一层再用。
 */
function stripServerPrefix(toolName: string): string {
  const lower = toolName.trim().toLowerCase()
  const sep = lower.lastIndexOf('__')
  return sep >= 0 ? lower.slice(sep + 2) : lower
}

function classifyToolEffect(name: string): ToolEffect {
  const tokens = stripServerPrefix(name)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(function (token) {
      return token.length > 0
    })
  if (
    tokens.some(function (token) {
      return WRITE_VERBS.has(token)
    })
  ) {
    return 'write'
  }
  if (
    tokens.some(function (token) {
      return READ_VERBS.has(token)
    })
  ) {
    return 'read'
  }
  return 'write'
}

function isWriteTool(name: string): boolean {
  return classifyToolEffect(name) === 'write'
}

export { READ_VERBS, WRITE_VERBS, classifyToolEffect, isWriteTool, stripServerPrefix }
export type { ToolEffect }
