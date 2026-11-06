/**
 * 工具行右侧那一小段摘要：从实参里挑一个「最像这一步在干什么」的字符串。
 *
 * 为什么需要它：折叠行只留一行时，光有工具名几乎读不出差别 —— 十几次 `read`
 * 都是「读取文件」，十几次 `app_browser_click` 都是「点击元素」。挑出路径 / 命令 /
 * 查询词当后缀，扫一眼就知道跳到哪一步，不用逐条展开。
 *
 * 三条约束：
 * - **只读实参，不读输出**：输出往往几千字，而且经常是同一段模板；
 * - **只取第一个命中的键**：摘要是一行提示，不是参数面板；
 * - **压成单行并裁剪**：多行命令 / 长提示词不能把折叠行撑成两行（行高是常数）。
 */

/** 按「信息量」排的候选键，靠前的先赢 */
const SUMMARY_KEYS: readonly string[] = [
  'path',
  'file_path',
  'filePath',
  'absolute_path',
  'relative_path',
  'file',
  'command',
  'cmd',
  'query',
  'pattern',
  'url',
  'selector',
  'name',
  'title',
  'prompt',
  'goal'
]

const DEFAULT_MAX_LENGTH = 72

/** 字符串直接用；字符串数组（如多文件路径）用空格拼起来 */
function pickText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts = value.filter(function (item): item is string {
      return typeof item === 'string'
    })
    return parts.length > 0 ? parts.join(' ') : null
  }
  return null
}

/** 折成单行：多行命令 / 带缩进的提示词都只留第一行可读的形态 */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function clip(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

/**
 * 工具实参 → 一行摘要。取不到（实参不是对象 / 没有候选键 / 候选值是空串）时返回
 * `undefined`，折叠行就保持「只有工具名」的形态，不留空占位。
 */
function toolCallSummary(args: unknown, maxLength = DEFAULT_MAX_LENGTH): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const record = args as Record<string, unknown>

  for (const key of SUMMARY_KEYS) {
    const picked = pickText(record[key])
    if (!picked) continue
    const text = collapse(picked)
    if (text) return clip(text, maxLength)
  }

  return undefined
}

export { toolCallSummary, SUMMARY_KEYS, DEFAULT_MAX_LENGTH }
