/**
 * Wiki 结构 lint：断链 / 孤儿页 / 聚合页缺失，以及规范项（缺 type、type 与目录不符、未进 index）。
 */
import { parseFrontMatter } from '@/views/knowledge/lib/front-matter.ts'
import { TYPE_DIR, findWikiDirForType } from '@/views/knowledge/lib/wiki-type-dirs.ts'

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g

interface WikiPage {
  relative: string
  title: string
  content: string
}

type LintIssueKind =
  | 'broken-link'
  | 'orphan'
  | 'missing-index'
  | 'duplicate-title'
  | 'thin-page'
  | 'missing-type'
  | 'type-dir-mismatch'
  | 'not-in-index'

interface LintIssue {
  id: string
  kind: LintIssueKind
  page: string
  detail: string
}

function parseWikilinks(content: string): string[] {
  const titles: string[] = []
  WIKILINK_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WIKILINK_RE.exec(content))) {
    const title = match[1]?.trim()
    if (title) titles.push(title)
  }
  return titles
}

function findPageKey(page: WikiPage): string {
  return page.title.trim().toLowerCase()
}

function lintWikiPages(pages: WikiPage[]): LintIssue[] {
  const byTitle = new Map<string, WikiPage>()
  for (const page of pages) {
    byTitle.set(findPageKey(page), page)
  }

  const issues: LintIssue[] = []
  const inbound = new Map<string, number>()

  for (const page of pages) {
    for (const link of parseWikilinks(page.content)) {
      const key = link.toLowerCase()
      inbound.set(key, (inbound.get(key) ?? 0) + 1)
      if (!byTitle.has(key)) {
        issues.push({
          id: `broken:${page.relative}:${link}`,
          kind: 'broken-link',
          page: page.relative,
          detail: `断链 [[${link}]]`
        })
      }
    }
  }

  for (const page of pages) {
    const key = findPageKey(page)
    if ((inbound.get(key) ?? 0) === 0 && !/index\.md$/i.test(page.relative)) {
      issues.push({
        id: `orphan:${page.relative}`,
        kind: 'orphan',
        page: page.relative,
        detail: '无入链（可能是孤儿页）'
      })
    }
  }

  const hasIndex = pages.some(function (page) {
    return /wiki[/\\]index\.md$/i.test(page.relative) || page.title.toLowerCase() === 'index'
  })
  if (!hasIndex) {
    issues.push({
      id: 'missing-index',
      kind: 'missing-index',
      page: 'wiki/index.md',
      detail: '缺少 index.md'
    })
  }

  // 规范项：内容页必须有合法 type、落到对应目录、并出现在 index 里
  const indexPage = pages.find(function (page) {
    return /wiki[/\\]index\.md$/i.test(page.relative) || page.title.trim().toLowerCase() === 'index'
  })
  const indexContent = indexPage?.content ?? ''
  for (const page of pages) {
    const relative = page.relative.replace(/\\/g, '/')
    if (!relative.startsWith('wiki/')) continue
    if (/^wiki\/(index|log|overview)\.md$/i.test(relative)) continue

    const { frontMatter } = parseFrontMatter(page.content)
    const typeMatch = frontMatter?.match(/^type:\s*(\S+)/m)
    const type = typeMatch?.[1]?.trim().toLowerCase()
    if (!type || !(type in TYPE_DIR)) {
      issues.push({
        id: `type:${page.relative}`,
        kind: 'missing-type',
        page: page.relative,
        detail: `缺少合法 type（当前：${type || '空'}）`
      })
    } else {
      const dir = findWikiDirForType(type)
      if (dir !== 'wiki' && !relative.startsWith(`${dir}/`)) {
        issues.push({
          id: `typedir:${page.relative}`,
          kind: 'type-dir-mismatch',
          page: page.relative,
          detail: `type=${type} 应落在 ${dir}/`
        })
      }
    }

    if (indexContent && !indexContent.includes(`[[${page.title}]]`)) {
      issues.push({
        id: `index:${page.relative}`,
        kind: 'not-in-index',
        page: page.relative,
        detail: '未出现在 wiki/index.md（可在设置 → 维护里重建索引）'
      })
    }
  }

  return issues
}

/** 语义向检查：重复标题、过短正文（非 LLM，本地启发式）。 */
function lintWikiSemantic(pages: WikiPage[]): LintIssue[] {
  const issues: LintIssue[] = []
  const byTitle = new Map<string, WikiPage[]>()
  for (const page of pages) {
    if (/wiki[/\\](index|log|overview)\.md$/i.test(page.relative)) continue
    const key = page.title.trim().toLowerCase()
    if (!key) continue
    const bucket = byTitle.get(key) || []
    bucket.push(page)
    byTitle.set(key, bucket)
  }
  for (const [title, group] of byTitle) {
    if (group.length < 2) continue
    for (const page of group) {
      issues.push({
        id: `dup:${page.relative}`,
        kind: 'duplicate-title',
        page: page.relative,
        detail: `标题「${title}」重复 ${group.length} 次`
      })
    }
  }
  for (const page of pages) {
    if (/wiki[/\\](index|log|overview)\.md$/i.test(page.relative)) continue
    const body = page.content.replace(/^---[\s\S]*?---\s*/, '').trim()
    if (body.length > 0 && body.length < 80) {
      issues.push({
        id: `thin:${page.relative}`,
        kind: 'thin-page',
        page: page.relative,
        detail: `正文过短（${body.length} 字）`
      })
    }
  }
  return issues
}

export { lintWikiPages, lintWikiSemantic, parseWikilinks }
export type { WikiPage, LintIssue, LintIssueKind }
