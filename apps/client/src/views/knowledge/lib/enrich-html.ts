/** 将 Markdown 源中的 wikilink / 数学 / Mermaid 预处理为 TipTap 可解析 HTML 片段 */

import { WIKILINK_PATTERN } from '@/views/knowledge/lib/wiki-link.ts'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * `[[页面|别名]]` → `<a data-wikilink …>`；不转义文本会被 marked 当成 HTML 吃掉。
 * 代码块（``` / ~~~）与行内代码（`…`）里的双括号保持原样。
 *
 * 注意：此处是「wikilink 语法 → 锚点 DOM」，与 `enrich-wikilinks.ts` 的
 * `enrichWikilinks`（裸标题提及 → `[[…]]`）是两个相反方向，不合并。
 */
function toWikiLinkAnchorsInLine(line: string): string {
  return line
    .split(/(`[^`]*`)/)
    .map(function (segment, index) {
      if (index % 2 === 1) return segment
      return segment.replace(WIKILINK_PATTERN, function (_full, target: string, alias?: string) {
        const title = target.trim()
        if (!title) return _full
        const label = alias?.trim() || title
        const aliasAttr = alias?.trim()
          ? ` data-wikilink-alias="${escapeHtml(alias.trim())}"`
          : ''
        return `<a data-wikilink data-wikilink-title="${escapeHtml(title)}"${aliasAttr}>${escapeHtml(label)}</a>`
      })
    })
    .join('')
}

function toWikiLinkAnchors(body: string): string {
  const lines: string[] = []
  let inFence = false
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      lines.push(line)
      continue
    }
    lines.push(inFence ? line : toWikiLinkAnchorsInLine(line))
  }
  return lines.join('\n')
}

function enrichMarkdownBody(body: string): string {
  let next = toWikiLinkAnchors(body)

  next = next.replace(/```mermaid\s*\n([\s\S]*?)```/g, function (_full, source: string) {
    const safe = escapeHtml(source.trim())
    return `\n<div data-type="mermaid-block" data-source="${safe}"><pre>${safe}</pre></div>\n`
  })

  next = next.replace(/\$\$([\s\S]+?)\$\$/g, function (_full, formula: string) {
    const safe = escapeHtml(formula.trim())
    return `\n<div data-type="math-block" data-formula="${safe}"></div>\n`
  })

  next = next.replace(
    /(^|[^$])\$([^\n$]+?)\$([^$]|$)/g,
    function (_full, before: string, formula: string, after: string) {
      const safe = escapeHtml(formula.trim())
      return `${before}<span data-type="math-inline" data-formula="${safe}"></span>${after}`
    }
  )

  return next
}

export { enrichMarkdownBody, escapeHtml }
