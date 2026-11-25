/**
 * 工具效果分类：**写动词优先**，读动词次之，认不出来一律按写（fail-closed）。
 *
 * why 不用 `includes`：`budget` / `target` / `widget` / `transaction` 里的 `get`、`action`
 * 会把写工具判成读；第三方 MCP 的 `push_files` / `send_message` 会被当成只读直接放行。
 *
 * why `open` / `fetch` 不在只读动词里：它们是**歧义动词** —— `open_pr`（建 PR）、
 * `fetch_url`（可能是 webhook）都会被判成只读，于是在 auto 档被直接放行。只读的联网工具
 * （`webfetch` / `websearch` …）改由 `EXPLICIT_READ_NAMES` 逐个兜住，宁可多问一次。
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
  'status',
  'info',
  'glob',
  'grep',
  'lint',
  'action',
  'actions',
  'directive',
  'directives',
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
 * 动词表判成只读、但调用本身会改状态的工具。
 * `open` 在只读动词里，打开网页仍算副作用。
 */
const EXPLICIT_WRITE_NAMES: ReadonlySet<string> = new Set(['cogito_browser_open'])

/**
 * 名字里带写动词、但只是查看的工具。
 * `terminal` 在写动词里，否则 `cogito_terminal_read` / `list` 会在计划模式被拒。
 */
const EXPLICIT_READ_NAMES: ReadonlySet<string> = new Set([
  'cogito_terminal_read',
  'cogito_terminal_list',
  'cogito_agent_wait',
  'cogito_agent_result',
  // 联网只读：`open` / `fetch` 已经从动词表里移出（`open_pr` / `fetch_url` 这类第三方
  // 写工具会被它们误判成只读），这几个已知只读的名字改由精确名单兜住
  'webfetch',
  'web_fetch',
  'websearch',
  'web_search'
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
  const bare = stripServerPrefix(name)
  if (EXPLICIT_WRITE_NAMES.has(bare)) return 'write'
  if (EXPLICIT_READ_NAMES.has(bare)) return 'read'
  const tokens = bare
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

/**
 * **命令类**工具：改的是外部状态（终端 / 进程 / 网络），不是仓库文件。
 *
 * 与「写文件」分开的理由：计划模式只读，但它需要调研 —— `git diff`、`ls`、跑一次
 * 单测看现状，这些都是命令。一律硬拒会让计划只能靠猜（“看不到现状 → 给一份空泛方案
 * → 收尾”）。所以计划模式对命令是**问用户**（批准了才跑），对文件写才是直接拒。
 */
const COMMAND_TOOL_NAMES: ReadonlySet<string> = new Set([
  'cogito_terminal_run',
  'cogito_terminal_write'
])

function isCommandTool(name: string): boolean {
  return COMMAND_TOOL_NAMES.has(stripServerPrefix(name))
}

function isWriteTool(name: string): boolean {
  return classifyToolEffect(name) === 'write'
}

export { READ_VERBS, WRITE_VERBS, classifyToolEffect, isCommandTool, isWriteTool, stripServerPrefix }
export type { ToolEffect }
