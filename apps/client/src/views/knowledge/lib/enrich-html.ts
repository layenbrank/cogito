/** 将 Markdown 源中的数学 / Mermaid 预处理为 TipTap 可解析 HTML 片段 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function enrichMarkdownBody(body: string): string {
  let next = body

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
