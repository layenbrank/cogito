/**
 * `[[页面]]` / `[[页面|别名]]` 的编辑 ↔ Markdown 双向转换。
 *
 * 供两处使用：
 * - `enrich-html.ts`：Markdown → 编辑器 HTML（把 wikilink 变成 `a[data-wikilink]`）
 * - `serialize-markdown.ts`：编辑器 HTML → Markdown（还原成 `[[页面]]`）
 *
 * 别名只影响显示文本，`title` 始终是跳转目标，和 Obsidian 的 `[[页面|显示名]]` 一致。
 */
const WIKILINK_PATTERN = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g

interface WikiLinkParts {
  /** 跳转目标（可含 `#标题`，本仓库只用作页面名） */
  title: string
  /** 显示文本；与 title 相同则为 null */
  alias: string | null
}

function parseWikiLink(raw: string): WikiLinkParts | null {
  WIKILINK_PATTERN.lastIndex = 0
  const match = WIKILINK_PATTERN.exec(raw)
  if (!match) return null
  const title = (match[1] ?? '').trim()
  if (!title) return null
  const alias = match[2]?.trim() || null
  return { title, alias }
}

/** 链接文本与目标不一致时才写别名 */
function toWikiLinkMarkdown(title: string, alias: string | null): string {
  return alias && alias !== title ? `[[${title}|${alias}]]` : `[[${title}]]`
}

export { WIKILINK_PATTERN, parseWikiLink, toWikiLinkMarkdown }
export type { WikiLinkParts }
