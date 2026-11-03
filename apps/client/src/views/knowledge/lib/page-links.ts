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

function findPageLinks(pages: WikiPage[], currentRelative: string): PageLinkBuckets {
  const byTitle = new Map<string, WikiPage>()
  for (const page of pages) {
    byTitle.set(page.title.trim().toLowerCase(), page)
  }
  const current = pages.find(function (page) {
    return page.relative.replace(/\\/g, '/') === currentRelative.replace(/\\/g, '/')
  })
  const outbound = current ? parseWikilinks(current.content) : []
  const broken = outbound.filter(function (title) {
    return !byTitle.has(title.toLowerCase())
  })
  const inbound: string[] = []
  const currentTitle = current?.title.trim().toLowerCase()
  if (currentTitle) {
    for (const page of pages) {
      if (page === current) continue
      for (const link of parseWikilinks(page.content)) {
        if (link.toLowerCase() === currentTitle) {
          inbound.push(page.title)
          break
        }
      }
    }
  }
  return {
    outbound: [...new Set(outbound)],
    inbound: [...new Set(inbound)],
    broken: [...new Set(broken)]
  }
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

export { findPageLinks, insertMissingWikiPage, readWikiPagesFromDocs }
export type { PageLinkBuckets }
