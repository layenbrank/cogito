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
  app_workspace_list: '列出工作区',
  app_workspace_read: '读取工作区文件',
  // 旧 daemon RPC 名（兼容历史会话里的工具名）
  list_actions: '列出动作',
  list_directives: '列出指令',
  directives: '列出指令',
  read_directive: '读取指令',
  save_directive: '保存指令',
  delete_directive: '删除指令',
  validate_directive: '校验指令',
  run_directive: '运行指令',
  import_directives: '导入指令',
  list_runs: '列出运行',
  cancel_execution: '取消运行',
  invoke: '试跑动作'
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

export { isCodeTool, isShellTool, toAgentToolLabel }
