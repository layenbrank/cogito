/**
 * 维护：重建 index、标题去重扫描、wikilink enrich。
 */
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

import { enrichWikilinks } from '@/views/knowledge/lib/enrich-wikilinks.ts'
import { joinPath } from '@/views/knowledge/lib/path.ts'
import { pushReviewItem } from '@/views/knowledge/lib/review-store.ts'

interface RebuildIndexInput {
  rootPath: string
  pages: { relative: string; title: string }[]
}

async function rebuildWikiIndex(input: RebuildIndexInput): Promise<void> {
  const path = joinPath(input.rootPath, 'wiki/index.md')
  const parent = joinPath(input.rootPath, 'wiki')
  if (!(await exists(parent))) await mkdir(parent, { recursive: true })

  let header =
    '---\ntitle: Index\ntype: index\n---\n\n# Index\n\n内容目录（维护工具重建）。\n\n## Pages\n\n'
  if (await exists(path)) {
    try {
      const existing = await readTextFile(path)
      const before = existing.split(/## Pages/)[0]
      header = `${before.trimEnd()}\n\n## Pages\n\n`
    } catch (error) {
      console.warn('[maintenance] read index failed', error)
    }
  }

  const bullets = input.pages
    .filter(function (page) {
      return !/wiki[/\\](index|log|overview)\.md$/i.test(page.relative)
    })
    .map(function (page) {
      return `- [[${page.title}]] (\`${page.relative.replace(/\\/g, '/')}\`)`
    })
    .join('\n')

  await writeTextFile(path, `${header}${bullets}\n`)
}

const HISTORY_KEY = 'knowledge.file-history'

interface FileHistoryEntry {
  path: string
  at: number
  note?: string
}

function readFileHistory(): FileHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as FileHistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.warn('[file-history] read failed', error)
    return []
  }
}

function pushFileHistory(path: string, note?: string): void {
  try {
    const next = [{ path, at: Date.now(), note }, ...readFileHistory()].slice(0, 100)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch (error) {
    console.warn('[file-history] write failed', error)
  }
}

interface DuplicateTitleGroup {
  title: string
  pages: { relative: string; title: string }[]
}

/** 按标题（忽略大小写）找重复页，最小可用去重扫描。 */
function findDuplicateTitleGroups(
  pages: { relative: string; title: string }[]
): DuplicateTitleGroup[] {
  const buckets = new Map<string, { relative: string; title: string }[]>()
  for (const page of pages) {
    if (/wiki[/\\](index|log|overview)\.md$/i.test(page.relative)) continue
    const key = page.title.trim().toLowerCase()
    if (!key) continue
    const bucket = buckets.get(key) || []
    bucket.push(page)
    buckets.set(key, bucket)
  }
  const groups: DuplicateTitleGroup[] = []
  for (const [key, group] of buckets) {
    if (group.length < 2) continue
    groups.push({ title: group[0]?.title || key, pages: group })
  }
  return groups
}

function enqueueDuplicateReviews(groups: DuplicateTitleGroup[]): number {
  let count = 0
  for (const group of groups) {
    pushReviewItem({
      title: group.title,
      prompt: `重复标题「${group.title}」：${group.pages
        .map(function (page) {
          return page.relative
        })
        .join(' · ')}。请合并或改名。`,
      status: 'pending',
      kind: 'duplicate',
      wikiPath: group.pages[0]?.relative
    })
    count += 1
  }
  return count
}

async function enrichWikiWikilinks(input: {
  rootPath: string
  pages: { relative: string; title: string }[]
}): Promise<number> {
  const titles = input.pages
    .map(function (page) {
      return page.title
    })
    .filter(Boolean)
  let updated = 0
  for (const page of input.pages) {
    if (/wiki[/\\](index|log|overview)\.md$/i.test(page.relative)) continue
    const absolute = joinPath(input.rootPath, page.relative)
    try {
      if (!(await exists(absolute))) continue
      const previous = await readTextFile(absolute)
      const next = enrichWikilinks(previous, titles)
      if (next === previous) continue
      await writeTextFile(absolute, next)
      updated += 1
      pushFileHistory(page.relative, 'enrich-wikilinks')
    } catch (error) {
      console.warn('[maintenance] enrich failed', page.relative, error)
    }
  }
  return updated
}

export {
  enqueueDuplicateReviews,
  enrichWikiWikilinks,
  findDuplicateTitleGroups,
  pushFileHistory,
  readFileHistory,
  rebuildWikiIndex
}
export type { DuplicateTitleGroup, FileHistoryEntry, RebuildIndexInput }
