/**
 * Callout（`> [!note]` 块）。
 *
 * Obsidian / 语雀「高亮块」的等价物：agent 写的长文里，结论与风险最适合用它承载。
 * 这里只做**标记 → HTML**（marked 之后跑），反向在 `serialize-markdown.ts` 的 turndown 规则里。
 *
 * 为什么在 HTML 阶段做而不是 Markdown 阶段：`> [!x]` 是引用块的一种写法，marked 已经把它解析成
 * `<blockquote><p>[!x] …</p>…</blockquote>`；在 HTML 上改写不会打乱其余 Markdown 语法（列表 / 表格 / 代码）。
 */
import { escapeHtml } from '@/views/knowledge/lib/enrich-html.ts'

/** 类型 → 默认标题（写成中文，因为界面语言是中文；显式标题优先） */
const CALLOUT_LABELS = {
  note: '提示',
  tip: '技巧',
  info: '信息',
  success: '结论',
  warning: '注意',
  danger: '警告',
  quote: '引用',
  example: '示例'
} as const

type CalloutType = keyof typeof CALLOUT_LABELS

/**
 * `<blockquote><p>[!type] 标题</p>正文…</blockquote>`。
 *
 * 标题只取标记**同一行**的内容（marked 会把 `> [!note]\n> 正文` 合成一个段落，
 * 用软换行分隔）——不这么切，标题会把正文第一句吃掉。
 */
const CALLOUT_BLOCK = /<blockquote>\s*<p>\[!([A-Za-z][\w-]*)\]([^<\n]*)\n?([\s\S]*?)<\/blockquote>/g

function isCalloutType(value: string): value is CalloutType {
  return Object.hasOwn(CALLOUT_LABELS, value)
}

function findCalloutLabel(type: string): string {
  return isCalloutType(type) ? CALLOUT_LABELS[type] : type
}

/**
 * 把引用式 callout 改写成 `div[data-callout]`。
 *
 * 未知类型不丢弃：按名字原样渲染（与 Obsidian 一致），避免用户写错单词就整块变成普通引用。
 */
function toCalloutHtml(html: string): string {
  return html.replace(
    CALLOUT_BLOCK,
    function (_full, rawType: string, rawTitle: string, tail: string) {
      const type = rawType.toLowerCase()
      const title = rawTitle.trim() || findCalloutLabel(type)
      // 首段被我们吃掉了起始 `<p>`：剩余文本要补回来，否则 HTML 不平衡
      const body = tail.trimStart()
      const restored = body.startsWith('<') ? body : `<p>${body}`
      return `<div data-callout="${escapeHtml(type)}" data-callout-title="${escapeHtml(title)}">${restored.trim() || '<p></p>'}</div>`
    }
  )
}

export { CALLOUT_LABELS, isCalloutType, toCalloutHtml }
export type { CalloutType }
