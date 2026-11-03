/**
 * 按 frontmatter type 落到 wiki/entities|concepts|sources/…
 */
const TYPE_DIR: Record<string, string> = {
  entity: 'wiki/entities',
  concept: 'wiki/concepts',
  source: 'wiki/sources',
  claim: 'wiki/claims',
  query: 'wiki/queries'
}

function findWikiDirForType(type: string): string {
  const key = type.trim().toLowerCase()
  return TYPE_DIR[key] || 'wiki'
}

function buildTypedWikiPath(type: string, slug: string): string {
  const dir = findWikiDirForType(type)
  const safe = slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `page-${Date.now()}`
  return `${dir}/${safe}.md`
}

function groupDocsByType(
  docs: { relPath: string; title: string }[],
  frontmatterTypeByPath: Record<string, string>
): Record<string, { relPath: string; title: string }[]> {
  const groups: Record<string, { relPath: string; title: string }[]> = {}
  for (const doc of docs) {
    const type = frontmatterTypeByPath[doc.relPath] || 'other'
    if (!groups[type]) groups[type] = []
    groups[type].push(doc)
  }
  return groups
}

export { TYPE_DIR, buildTypedWikiPath, findWikiDirForType, groupDocsByType }
