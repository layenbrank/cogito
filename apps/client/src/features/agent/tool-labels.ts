/**
 * goose / ACP 工具名 → 中文标题（工具卡摘要行）。
 * 未收录的名字原样返回，避免空白标题。
 */

const TOOL_LABELS: Readonly<Record<string, string>> = {
  shell: '执行命令',
  bash: '执行命令',
  terminal: '执行命令',
  execute: '执行代码',
  read: '读取文件',
  read_file: '读取文件',
  write: '写入文件',
  write_file: '写入文件',
  edit: '修改文件',
  text_editor: '编辑文件',
  str_replace: '替换文本',
  glob: '匹配文件',
  grep: '检索内容',
  list_dir: '列出目录',
  search: '搜索',
  web_search: '联网搜索',
  websearch: '联网搜索',
  webfetch: '抓取网页',
  web_fetch: '抓取网页',
  skill: '调用技能',
  subagent: '派生子任务',
  memory: '记忆',
  todo: '待办',
  // corex MCP（与指令磁贴共用；goose 名可能带 server 前缀，靠 includes 命中）
  // 注意：复数名放前面，避免 `corex_actions` 被 `corex_action` 先命中
  corex_actions: '列出动作',
  corex_action: '动作详情',
  corex_invoke: '试跑动作',
  corex_run: '运行指令',
  corex_directives: '列出指令',
  corex_directive: '读取指令',
  corex_validate: '校验指令',
  // 本地工具（cogito-mcp，app_ 前缀）
  app_calendar_read: '读取日程',
  app_knowledge_list_bases: '列出知识库',
  app_knowledge_list_docs: '列出文档',
  app_knowledge_read_doc: '读取文档',
  app_knowledge_read_wiki: '读取 Wiki 页',
  app_knowledge_search: '检索知识',
  app_knowledge_lint: '检查 Wiki 结构',
  app_knowledge_ingest: '入队摄入 Wiki',
  app_knowledge_write_doc: '写入知识草稿',
  app_knowledge_graph_search: '图谱邻居检索',
  app_knowledge_workspace_write: '写入 .agent 产物',
  app_workspace_write: '写入工作区文件',
  app_workspace_patch: '定点修改工作区文件',
  app_terminal_run: '终端执行',
  app_terminal_read: '读取终端输出',
  app_terminal_write: '写入终端',
  app_terminal_list: '列出终端会话',
  app_browser_open: '打开网页',
  app_browser_read: '读取网页',
  app_browser_act: '操作网页',
  app_browser_screenshot: '网页截图',
  app_browser_network: '网页请求',
  app_browser_intercept: '拦截请求',
  app_browser_device: '设备模拟',
  app_workspace_list: '列出工作区',
  app_workspace_read: '读取工作区文件'
}

function isBrowserTool(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('app_browser_') || lower.includes('browser_')
}

/** 从工具参数 / 结果里抽出目标 tab label（`browser-<uuid>`） */
function findBrowserToolLabel(args: unknown, result: unknown): string | null {
  const fromArgs = readLabelField(args, 'tab') ?? readLabelField(args, 'label')
  if (fromArgs) return fromArgs
  return readLabelField(result, 'label') ?? readLabelField(result, 'tab')
}

function readLabelField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null
  const raw = (value as Record<string, unknown>)[key]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed === 'active') return null
  return trimmed
}

function toAgentToolLabel(name: string): string {
  if (!name) return '工具'
  const direct = TOOL_LABELS[name]
  if (direct) return direct
  const lower = name.toLowerCase()
  const matched = Object.entries(TOOL_LABELS).find(function (entry) {
    return lower.includes(entry[0])
  })
  return matched?.[1] ?? name
}

/** 是否按「命令终端」卡渲染（goose 工具名常带前缀） */
function isShellTool(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower === 'shell' ||
    lower === 'bash' ||
    lower === 'terminal' ||
    lower.includes('shell') ||
    lower.includes('bash') ||
    lower.includes('terminal') ||
    lower.includes('exec')
  )
}

/**
 * 是否跑在**右栏嵌入式终端**里的工具（`app terminal run/read/write/list`）。
 *
 * 这类工具的正文输出本来就落在用户能看见的那个终端里：对话流再摆一份完整终端，
 * 就是同一段输出两个终端。卡片只做「收据 + 跳过去看」。
 */
function isEmbeddedTerminalTool(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('app terminal ') || lower.includes('app_terminal_')
}

function isCodeTool(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === 'execute' || lower.includes('execute') || lower.includes('code_mode')
}

/**
 * 工具卡形态：只剩基础形态 + 目录列举。
 * commit / test / stack / package / env / schema / snippet 七种「从输出文本猜出来」的
 * 专项卡已下线（`parse-tool-result.ts` 头注），不再作为可渲染形态存在。
 */
type ToolCardVariant =
  | 'command'
  | 'code'
  | 'read'
  | 'write'
  | 'search'
  | 'web'
  | 'retrieval'
  | 'timeline'
  | 'generic'
  | 'tree'

function isReadTool(name: string): boolean {
  if (isBrowserTool(name)) return false
  const lower = name.toLowerCase()
  return (
    lower === 'read' ||
    lower.includes('read_file') ||
    lower.includes('read_doc') ||
    (lower.includes('read') && !lower.includes('thread'))
  )
}

function isWriteTool(name: string): boolean {
  if (isBrowserTool(name)) return false
  const lower = name.toLowerCase()
  return (
    lower === 'write' ||
    lower.includes('write_file') ||
    lower.includes('write_doc') ||
    lower.includes('edit') ||
    lower.includes('str_replace') ||
    lower.includes('text_editor')
  )
}

function isSearchTool(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.includes('grep') ||
    lower.includes('glob') ||
    lower.includes('list_dir') ||
    lower === 'search' ||
    lower.includes('knowledge_search')
  )
}

/**
 * 库内检索：`app_knowledge_search` / `cogito_knowledge_search`（带 server 前缀也命中）。
 *
 * 它返回的是**命中段落**（标题 / 路径 / 片段 / 分数），所以走
 * `elements/retrieval-chunks` 那张卡；不要当普通 search 流到通用行里摆 JSON。
 */
function isRetrievalTool(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('knowledge_search') || lower.includes('search_knowledge')
}

/**
 * 日历类工具：`app_calendar_read`（MCP 名可能带 server 前缀）。
 *
 * 它的结果是一**组带时刻的事件**，交给 `elements/timeline` 那张竖轴卡；
 * 注意它名字里带 `read`，判定必须排在 `isReadTool` 前面，否则会被当成「读文件」。
 */
function isCalendarTool(name: string): boolean {
  return name.toLowerCase().includes('calendar')
}

/**
 * 联网类工具：`web_search` / `web_fetch`（goose 名常带 server 前缀，靠 includes 命中）。
 *
 * 这类工具的结果是一**组**来源，不是一段正文 —— 交给 `elements/web-search` 那张卡
 * （查询药丸 + 读了 N 条 + 逐条域名行），而不是通用卡里一整块 JSON 文本。
 */
function isWebTool(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.includes('web_search') ||
    lower.includes('websearch') ||
    lower.includes('search_web') ||
    lower.includes('webfetch') ||
    lower.includes('web_fetch')
  )
}

function isGitTool(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('git') || lower.includes('commit')
}

export {
  findBrowserToolLabel,
  isBrowserTool,
  isCalendarTool,
  isCodeTool,
  isEmbeddedTerminalTool,
  isGitTool,
  isReadTool,
  isRetrievalTool,
  isSearchTool,
  isShellTool,
  isWebTool,
  isWriteTool,
  toAgentToolLabel
}
export type { ToolCardVariant }
