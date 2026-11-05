/**
 * 两步 ingest：分析（可插 ACP）→ 写 wiki + 维护聚合页 → rescan；可选 embed。
 */
import { exists, mkdir, readFile, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

import { readEmbeddingConfig } from '@/views/knowledge/lib/embedding-config.ts'
import {
  digestSha256,
  findCacheBySha,
  rememberIngest
} from '@/views/knowledge/lib/ingest-cache.ts'
import { analyzeForIngest } from '@/views/knowledge/lib/ingest-analyze.ts'
import type { ParsedFileBlock } from '@/views/knowledge/lib/ingest-file-blocks.ts'
import { maintainAfterPages } from '@/views/knowledge/lib/ingest-wiki-maintain.ts'
import { captionImagePath } from '@/views/knowledge/lib/multimodal-caption.ts'
import { readMultimodalConfig } from '@/views/knowledge/lib/multimodal-config.ts'
import { mergePageContent } from '@/views/knowledge/lib/page-merge.ts'
import { persistParsedMarkdown } from '@/views/knowledge/lib/parsed-source-output.ts'
import { withParsingGate } from '@/views/knowledge/lib/parsing-gate.ts'
import { joinPath } from '@/views/knowledge/lib/path.ts'
import { extractPdfMarkdown } from '@/views/knowledge/lib/pdf-pipeline.ts'
import { pushReviewItem } from '@/views/knowledge/lib/review-store.ts'
import { readSourceWatchConfig } from '@/views/knowledge/lib/source-watch-config.ts'
import { upsertPageEmbeddings } from '@/views/knowledge/lib/vector-store.ts'
import { buildTypedWikiPath } from '@/views/knowledge/lib/wiki-type-dirs.ts'

interface IngestRunInput {
  rootPath: string
  path: string
}

interface IngestRunResult {
  skipped: boolean
  wikiPath: string
  title: string
  reason?: string
  wikiPaths?: string[]
}

function toRelative(root: string, absoluteOrRelative: string): string {
  const normalized = absoluteOrRelative.replace(/\\/g, '/')
  const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized.toLowerCase().startsWith(rootNorm.toLowerCase() + '/')) {
    return normalized.slice(rootNorm.length + 1)
  }
  return normalized.replace(/^\.?\//, '')
}

function slugify(title: string): string {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.slice(0, 48) || `source-${Date.now()}`
}

function fileStem(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path
  return base.replace(/\.[^.]+$/, '')
}

function parseTitleFromBody(body: string, fallback: string): string {
  const fm = body.match(/^---\s*\n([\s\S]*?)\n---/)
  if (fm?.[1]) {
    const titleLine = fm[1].match(/^title:\s*(.+)$/m)
    if (titleLine?.[1]) {
      return titleLine[1].replace(/^["']|["']$/g, '').trim() || fallback
    }
  }
  const heading = body.match(/^#\s+(.+)$/m)
  return (heading?.[1] ?? fallback).trim()
}

function resolveAbsolute(root: string, path: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/')) return path
  return joinPath(root, path)
}

function toWikiRelative(rootPath: string, absolute: string): string {
  const rootNorm = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const absNorm = absolute.replace(/\\/g, '/')
  if (absNorm.toLowerCase().startsWith(rootNorm.toLowerCase() + '/')) {
    return absNorm.slice(rootNorm.length + 1)
  }
  return absNorm
}

async function appendImageCaptions(
  rootPath: string,
  markdown: string,
  imagePaths: string[]
): Promise<string> {
  if (!readMultimodalConfig().enabled || imagePaths.length === 0) return markdown
  const lines: string[] = []
  for (const absolute of imagePaths) {
    const relative = toWikiRelative(rootPath, absolute)
    try {
      const caption = await captionImagePath(relative, fileStem(relative))
      lines.push(`- \`${relative}\`：${caption}`)
    } catch (error) {
      console.warn('[ingest] caption failed', relative, error)
    }
  }
  if (lines.length === 0) return markdown
  return `${markdown.trimEnd()}\n\n## 图片说明\n\n${lines.join('\n')}\n`
}

async function readSourceMarkdown(
  absolute: string,
  rootPath: string
): Promise<string> {
  return withParsingGate(async function () {
    if (/\.pdf$/i.test(absolute)) {
      const extracted = await extractPdfMarkdown({ absolute, rootPath })
      return appendImageCaptions(rootPath, extracted.markdown, extracted.imagePaths)
    }
    if (/\.(md|markdown|mdx|txt|org|html?|csv|json|ya?ml|xml)$/i.test(absolute)) {
      return readTextFile(absolute)
    }
    const bytes = await readFile(absolute)
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes).slice(0, 80_000)
  })
}

async function writeWikiBlock(
  root: string,
  block: ParsedFileBlock,
  sourceRelative: string
): Promise<{ title: string; wikiRelative: string }> {
  const wikiRelative = block.path.replace(/\\/g, '/')
  const wikiAbsolute = joinPath(root, wikiRelative)
  const slash = wikiRelative.lastIndexOf('/')
  if (slash > 0) {
    const parent = joinPath(root, wikiRelative.slice(0, slash))
    if (!(await exists(parent))) await mkdir(parent, { recursive: true })
  }

  let body = block.content.trimEnd() + '\n'
  if (!/sources:\s*\[/m.test(body)) {
    body = body.replace(
      /^---\s*\n([\s\S]*?)\n---/,
      `---\n$1\nsources: [${JSON.stringify(sourceRelative.replace(/\\/g, '/'))}]\n---`
    )
  }
  if (await exists(wikiAbsolute)) {
    try {
      const previous = await readTextFile(wikiAbsolute)
      body = mergePageContent(previous, body)
    } catch (error) {
      console.warn('[ingest] merge sources skipped', wikiRelative, error)
    }
  }

  await writeTextFile(wikiAbsolute, body)
  return {
    title: parseTitleFromBody(body, fileStem(wikiRelative)),
    wikiRelative
  }
}

async function runIngest(input: IngestRunInput): Promise<IngestRunResult> {
  const absolute = resolveAbsolute(input.rootPath, input.path)
  const relative = toRelative(input.rootPath, absolute)
  const bytes = await readFile(absolute)
  const sha256 = await digestSha256(bytes.buffer.slice(0))
  const cached = findCacheBySha(sha256)
  if (cached) {
    return {
      skipped: true,
      wikiPath: cached.wikiPath,
      title: fileStem(cached.wikiPath),
      reason: 'sha256-unchanged'
    }
  }

  let markdown: string
  try {
    markdown = await readSourceMarkdown(absolute, input.rootPath)
  } catch (error) {
    console.error('[ingest] read source failed', error)
    throw error
  }

  if (readSourceWatchConfig().persistExtractedMarkdown) {
    try {
      await persistParsedMarkdown(input.rootPath, relative, markdown)
    } catch (error) {
      console.warn(
        `[ingest] Failed to keep parsed Markdown for "${relative}":`,
        error instanceof Error ? error.message : error
      )
    }
  }

  const analyzed = await analyzeForIngest({
    relative,
    markdown,
    rootPath: input.rootPath
  })

  const blocks: ParsedFileBlock[] =
    analyzed.fileBlocks && analyzed.fileBlocks.length > 0
      ? analyzed.fileBlocks
      : [
          {
            path: buildTypedWikiPath('concept', slugify(analyzed.title)),
            content:
              analyzed.wikiBody?.trim() ||
              `---
title: ${JSON.stringify(analyzed.title)}
type: concept
sources: [${JSON.stringify(relative)}]${
                analyzed.tags.length > 0
                  ? `\ntags: [${analyzed.tags
                      .map(function (tag) {
                        return JSON.stringify(tag)
                      })
                      .join(', ')}]`
                  : ''
              }
---

# ${analyzed.title}

> 来源：\`${relative}\`

${analyzed.summary}

## 原文摘录

${markdown.slice(0, 12_000)}
`
          }
        ]

  const written: { title: string; wikiRelative: string; sourceRelative: string }[] = []
  for (const block of blocks) {
    const page = await writeWikiBlock(input.rootPath, block, relative)
    written.push({ ...page, sourceRelative: relative })
  }

  const primary = written[0]
  rememberIngest({
    sha256,
    relative,
    wikiPath: primary.wikiRelative,
    processedAt: Date.now()
  })

  await maintainAfterPages(input.rootPath, written)

  const embedding = readEmbeddingConfig()
  if (embedding.enabled && embedding.embedOnIngest) {
    const items = written.map(function (page) {
      return {
        docId: page.wikiRelative,
        text: `${page.title}\n${analyzed.summary}\n${markdown.slice(0, embedding.maxChunkChars)}`
      }
    })
    // embedding 是**可选增强**：写索引失败只记一条可上报的 warning，
    // 绝不阻断 ingest 主流程（旧版把异常抛在 await 链上，会让整次 ingest 失败）。
    void upsertPageEmbeddings(items)
      .then(function (ok) {
        if (ok < items.length) {
          console.warn(
            `[ingest] embedding 未全部完成：${ok}/${items.length}（搜索会降级到全文检索）`
          )
        }
      })
      .catch(function (error) {
        console.warn('[ingest] embed failed, 已忽略', error)
      })
  }

  if (analyzed.needsReview || (analyzed.parseWarnings?.length ?? 0) > 0) {
    pushReviewItem({
      title: primary.title,
      prompt:
        analyzed.parseWarnings?.[0] ||
        `资料「${relative}」抽取较弱或需人工确认，请检查 wiki 页。`,
      status: 'pending',
      kind: analyzed.parseWarnings?.length ? 'suggestion' : 'confirm',
      wikiPath: primary.wikiRelative,
      sourcePath: relative
    })
  }

  return {
    skipped: false,
    wikiPath: primary.wikiRelative,
    title: primary.title,
    wikiPaths: written.map(function (page) {
      return page.wikiRelative
    })
  }
}

export { runIngest }
export type { IngestRunInput, IngestRunResult }
