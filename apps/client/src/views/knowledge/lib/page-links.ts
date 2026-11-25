/**
 * Page Links：出链 / 反链 / 断链；一键建缺失页。
 */
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

import { joinPath } from '@/views/knowledge/lib/path.ts'
import { parseWikilinks, type WikiPage } from '@/views/knowledge/lib/wiki-lint.ts'
import { runInlinePrompt } from '@/features/agent/inline-prompt'

interface PageLinkBuckets {
  outbound: string[]
  inbound: string[]
  broken: string[]
}

/** 文档列表项里参与缓存指纹的字段（store 的 `KnowledgeDocSummary` 本来就带） */
interface PageLinkDocPointer {
  relPath: string
  title: string
  updatedAt?: number
  revision?: number
}

function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

/**
 * 一次算好的链接索引：`parseWikilinks` 是正则全文扫描，让它在「打开/切换文档」时
 * 对整库每页各跑一遍是最贵的部分。这里按语料版本建一次（出链表 + 标题 → 反链表），
 * 之后切文档就是两次 Map 查询。
 */
interface PageLinkIndex {
  /** 规范化相对路径 → 页面 */
  byPath: Map<string, WikiPage>
  /** 小写标题 → 页面 */
  byTitle: Map<string, WikiPage>
  /** 规范化相对路径 → 去重后的出链标题 */
  outbound: Map<string, string[]>
  /** 小写标题 → 引用它的页面标题集合 */
  inbound: Map<string, Set<string>>
}

function buildPageLinkIndex(pages: WikiPage[]): PageLinkIndex {
  const byPath = new Map<string, WikiPage>()
  const byTitle = new Map<string, WikiPage>()
  const outbound = new Map<string, string[]>()
  const inbound = new Map<string, Set<string>>()

  for (const page of pages) {
    const key = normalizeRelPath(page.relative)
    byPath.set(key, page)
    byTitle.set(page.title.trim().toLowerCase(), page)

    const links = [...new Set(parseWikilinks(page.content))].filter(function (link) {
      return link.trim().length > 0
    })
    outbound.set(key, links)
    for (const link of links) {
      const title = link.toLowerCase()
      const sources = inbound.get(title)
      if (sources) sources.add(page.title)
      else inbound.set(title, new Set([page.title]))
    }
  }

  return { byPath, byTitle, outbound, inbound }
}

function findPageLinksFromIndex(
  index: PageLinkIndex,
  currentRelative: string
): PageLinkBuckets {
  const key = normalizeRelPath(currentRelative)
  const current = index.byPath.get(key)
  if (!current) return { outbound: [], inbound: [], broken: [] }

  const outbound = index.outbound.get(key) ?? []
  const broken = outbound.filter(function (title) {
    return !index.byTitle.has(title.toLowerCase())
  })
  const selfTitle = current.title.trim().toLowerCase()
  const inbound = [...(index.inbound.get(selfTitle) ?? [])].filter(function (title) {
    return title.trim().toLowerCase() !== selfTitle
  })

  return { outbound, inbound, broken }
}

/** 一次性版本：手头只有正文时用；高频路径请用索引（见 `readPageLinkBuckets`） */
function findPageLinks(pages: WikiPage[], currentRelative: string): PageLinkBuckets {
  return findPageLinksFromIndex(buildPageLinkIndex(pages), currentRelative)
}

async function insertMissingWikiPage(input: {
  rootPath: string
  title: string
  draftWithAcp?: boolean
  context?: string
}): Promise<string> {
  const slug = input.title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .slice(0, 48) || `page-${Date.now()}`
  const relative = `wiki/${slug}.md`
  const absolute = joinPath(input.rootPath, relative)
  if (await exists(absolute)) return relative

  const parent = joinPath(input.rootPath, 'wiki')
  if (!(await exists(parent))) await mkdir(parent, { recursive: true })

  let body = `---\ntitle: ${JSON.stringify(input.title)}\ntype: concept\n---\n\n# ${input.title}\n\n`
  if (input.draftWithAcp) {
    try {
      const drafted = await runInlinePrompt({
        text: `为知识库撰写页面「${input.title}」的 Markdown 正文（不要 frontmatter）。上下文：\n${(input.context || '').slice(0, 4_000)}`,
        systemText: '只输出 Markdown 正文，不要工具调用。'
      })
      body += drafted.trim() + '\n'
    } catch (error) {
      console.error('[page-links] ACP draft failed', error)
      body += '> stub：ACP 起草失败，请人工补全。\n'
    }
  } else {
    body += '> stub：由 Page Links 创建的缺失页。\n'
  }

  await writeTextFile(absolute, body)
  return relative
}

async function readWikiPagesFromDocs(input: {
  rootPath: string
  docs: { relPath: string; title: string }[]
}): Promise<WikiPage[]> {
  const pages: WikiPage[] = []
  for (const doc of input.docs) {
    if (!/\.md$/i.test(doc.relPath)) continue
    try {
      const content = await readTextFile(joinPath(input.rootPath, doc.relPath))
      pages.push({ relative: doc.relPath, title: doc.title, content })
    } catch (error) {
      console.warn('[page-links] skip', doc.relPath, error)
    }
  }
  return pages
}

/**
 * 语料指纹：路径 + 更新时间 + 版本号。
 *
 * 只在 `docs` / 当前文档版本变化时重建索引；切文档、切页签都不再重新读盘。
 * 当前文档刚保存时 `activeDoc.revision` 会变，`version` 参数用它把缓存打穿。
 */
function findCorpusSignature(
  rootPath: string,
  docs: PageLinkDocPointer[],
  version: number | null | undefined
): string {
  const parts: string[] = [rootPath, String(version ?? 0)]
  for (const doc of docs) {
    parts.push(`${doc.relPath}:${doc.updatedAt ?? 0}:${doc.revision ?? 0}`)
  }
  return parts.join('\n')
}

/** 只保留最近几个语料的索引（切空间 / 局部刷新时不会无界增长） */
const INDEX_CACHE_LIMIT = 3
const indexCache = new Map<string, Promise<PageLinkIndex>>()

function readPageLinkIndex(input: {
  rootPath: string
  docs: PageLinkDocPointer[]
  version?: number | null
  force?: boolean
}): Promise<PageLinkIndex> {
  const signature = findCorpusSignature(input.rootPath, input.docs, input.version)
  if (!input.force) {
    const cached = indexCache.get(signature)
    if (cached) return cached
  }
  const task = readWikiPagesFromDocs({
    rootPath: input.rootPath,
    docs: input.docs
  }).then(buildPageLinkIndex)
  indexCache.set(signature, task)
  void task.catch(function () {
    indexCache.delete(signature)
  })
  while (indexCache.size > INDEX_CACHE_LIMIT) {
    const oldest = indexCache.keys().next().value
    if (oldest === undefined || oldest === signature) break
    indexCache.delete(oldest)
  }
  return task
}

/** Page Links 面板的唯一入口：缓存读盘 + 缓存索引，返回当前页的三组链接 */
async function readPageLinkBuckets(input: {
  rootPath: string | null | undefined
  relPath: string | null
  docs: PageLinkDocPointer[]
  version?: number | null
  force?: boolean
}): Promise<PageLinkBuckets | null> {
  if (!input.rootPath || !input.relPath) return null
  const index = await readPageLinkIndex({
    rootPath: input.rootPath,
    docs: input.docs,
    version: input.version,
    force: input.force
  })
  return findPageLinksFromIndex(index, input.relPath)
}

export {
  findPageLinks,
  insertMissingWikiPage,
  readPageLinkBuckets,
  readWikiPagesFromDocs
}
export type { PageLinkBuckets, PageLinkDocPointer }
