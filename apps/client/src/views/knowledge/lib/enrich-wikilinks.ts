/**
 * 将裸标题提及 enrich 为 [[wikilink]]（保守：仅已知页标题全词）。
 */
function enrichWikilinks(markdown: string, knownTitles: string[]): string {
  const titles = [...new Set(knownTitles.map(function (title) {
    return title.trim()
  }).filter(Boolean))].sort(function (a, b) {
    return b.length - a.length
  })
  if (titles.length === 0) return markdown

  const parts = markdown.split(/(```[\s\S]*?```|`[^`]+`|\[\[[^\]]+\]\])/g)
  return parts
    .map(function (part, index) {
      if (index % 2 === 1) return part
      let next = part
      for (const title of titles) {
        if (title.length < 2) continue
        const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(`(?<!\\[)\\b(${escaped})\\b(?!\\])`, 'g')
        next = next.replace(re, '[[$1]]')
      }
      return next
    })
    .join('')
}

export { enrichWikilinks }
