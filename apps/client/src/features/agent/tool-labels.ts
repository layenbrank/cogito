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
  todo: '待办'
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
