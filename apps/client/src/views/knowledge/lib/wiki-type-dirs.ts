/**
 * 按 frontmatter type 落到 wiki/entities|concepts|sources/…
 *
 * 镜像 Rust `knowledge::wiki::WIKI_TYPES`（唯一权威）；运行时可用
 * `GET_KNOWLEDGE_WIKI_CONTRACT()` 校对，不要在这里加 Rust 没有的类型。
 */
import { parseFrontMatter } from '@/views/knowledge/lib/front-matter.ts'

const TYPE_DIR: Record<string, string> = {
  entity: 'wiki/entities',
  concept: 'wiki/concepts',
  source: 'wiki/sources',
  query: 'wiki/queries',
  comparison: 'wiki/comparisons',
  synthesis: 'wiki/synthesis',
  note: 'wiki/notes',
  // 场景模板（主题阅读 / 商业团队）的内置类型
  character: 'wiki/characters',
  theme: 'wiki/themes',
  'plot-thread': 'wiki/plot-threads',
  chapter: 'wiki/chapters',
  meeting: 'wiki/meetings',
  decision: 'wiki/decisions',
  project: 'wiki/projects',
  stakeholder: 'wiki/stakeholders'
}

const DEFAULT_WIKI_TYPE = 'note'

function findWikiDirForType(type: string): string {
  const key = type.trim().toLowerCase()
  return TYPE_DIR[key] || 'wiki'
}

function toSafeSlug(slug: string): string {
  return (
    slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || `page-${Date.now()}`
  )
}

function buildTypedWikiPath(type: string, slug: string): string {
  return `${findWikiDirForType(type)}/${toSafeSlug(slug)}.md`
}

/** 从正文 frontmatter 读 `type`（小写）；没有或不在规范里就 null */
function findWikiTypeInContent(content: string): string | null {
  const { frontMatter } = parseFrontMatter(content)
  const matched = frontMatter?.match(/^type:\s*(.+)$/m)
  const value = matched?.[1]?.trim().replace(/^["']|["']$/g, '').toLowerCase()
  return value && value in TYPE_DIR ? value : null
}

/**
 * 已有路径归位：`wiki/xxx.md`（根级）按 type 重定向到 `wiki/<dir>/xxx.md`；
 * 已有子目录、聚合页、非 wiki 路径都原样返回。
 *
 * ingest 的 FILE 块与模型产物常用 `wiki/<标题>.md`，不重定向就会积出一堆
 * type-dir-mismatch 的根级页。
 */
function toTypedWikiRelative(relative: string, type: string | null | undefined): string {
  const normalized = relative.replace(/\\/g, '/')
  if (!normalized.startsWith('wiki/')) return normalized
  const rest = normalized.slice('wiki/'.length)
  if (rest.includes('/')) return normalized
  if (/^(index|log|overview)\.md$/i.test(rest)) return normalized
  return `${findWikiDirForType(type || DEFAULT_WIKI_TYPE)}/${rest}`
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

export {
  DEFAULT_WIKI_TYPE,
  TYPE_DIR,
  buildTypedWikiPath,
  findWikiDirForType,
  findWikiTypeInContent,
  groupDocsByType,
  toTypedWikiRelative
}
