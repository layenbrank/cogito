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
  app_knowledge_search: '检索知识',
  app_knowledge_write_doc: '写入知识草稿',
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

function isCodeTool(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === 'execute' || lower.includes('execute') || lower.includes('code_mode')
}

type ToolCardVariant =
  | 'command'
  | 'code'
  | 'read'
  | 'write'
  | 'search'
  | 'generic'
  | 'commit'
  | 'test'
  | 'stack'
  | 'package'
  | 'env'
  | 'schema'
  | 'snippet'
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

function isWebTool(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('web_search') || lower.includes('webfetch') || lower.includes('web_fetch')
}

function isGitTool(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('git') || lower.includes('commit')
}

export {
  findBrowserToolLabel,
  isBrowserTool,
  isCodeTool,
  isGitTool,
  isReadTool,
  isSearchTool,
  isShellTool,
  isWebTool,
  isWriteTool,
  toAgentToolLabel
}
export type { ToolCardVariant }
