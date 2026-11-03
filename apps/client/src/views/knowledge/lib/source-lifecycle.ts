/**
 * Sources 生命周期：导入扩展名判定、删除级联清理。
 */
import {
  copyFile,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile
} from '@tauri-apps/plugin-fs'

import { findCacheByPath, removeFromIngestCache } from '@/views/knowledge/lib/ingest-cache.ts'
import { removeParsedMarkdown } from '@/views/knowledge/lib/parsed-source-output.ts'
import { joinPath, findFileName } from '@/views/knowledge/lib/path.ts'
import { removePageEmbedding } from '@/views/knowledge/lib/vector-store.ts'
import { WIKI_DIR_RAW_SOURCES } from '@/views/knowledge/lib/wiki-scaffold.ts'

const INGESTABLE_SOURCE_EXTENSIONS = new Set([
  'md',
  'markdown',
  'mdx',
  'txt',
  'org',
  'pdf',
  'doc',
  'docx',
  'docm',
  'odt',
  'rtf',
  'epub',
  'mobi',
  'ppt',
  'pps',
  'pot',
  'pptx',
  'pptm',
  'ppsx',
  'ppsm',
  'odp',
  'xls',
  'xlsx',
  'xlsm',
  'xlsb',
  'ods',
  'csv',
  'html',
  'htm',
  'json',
  'yaml',
  'yml',
  'xml',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif'
])

interface ImportFolderResult {
  imported: string[]
  skipped: { path: string; reason: string }[]
}

function findExtension(path: string): string {
  const base = findFileName(path)
  const idx = base.lastIndexOf('.')
  if (idx < 0) return ''
  return base.slice(idx + 1).toLowerCase()
}

function isIngestableSourcePath(path: string): boolean {
  return INGESTABLE_SOURCE_EXTENSIONS.has(findExtension(path))
}

function toPosixRelative(root: string, absolute: string): string {
  const normalized = absolute.replace(/\\/g, '/')
  const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized.toLowerCase().startsWith(rootNorm.toLowerCase() + '/')) {
    return normalized.slice(rootNorm.length + 1)
  }
  return normalized
}

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readDir(dir)
  for (const entry of entries) {
    const child = joinPath(dir, entry.name)
    if (entry.isDirectory) {
      out.push(...(await walkFiles(child)))
    } else {
      out.push(child)
    }
  }
  return out
}

async function importFolderToSources(input: {
  rootPath: string
  folderPath: string
}): Promise<ImportFolderResult> {
  const sourcesRoot = joinPath(input.rootPath, WIKI_DIR_RAW_SOURCES)
  if (!(await exists(sourcesRoot))) {
    await mkdir(sourcesRoot, { recursive: true })
  }
  const folderName = findFileName(input.folderPath) || `folder-${Date.now()}`
  const destRoot = joinPath(sourcesRoot, folderName)
  if (!(await exists(destRoot))) {
    await mkdir(destRoot, { recursive: true })
  }

  const files = await walkFiles(input.folderPath)
  const imported: string[] = []
  const skipped: { path: string; reason: string }[] = []

  for (const absolute of files) {
    const relInside = toPosixRelative(input.folderPath, absolute)
    const dest = joinPath(destRoot, relInside)
    const destParent = dest.slice(0, dest.length - findFileName(dest).length)
    if (destParent && !(await exists(destParent))) {
      await mkdir(destParent, { recursive: true })
    }
    try {
      await copyFile(absolute, dest)
      const relative = toPosixRelative(input.rootPath, dest)
      if (isIngestableSourcePath(dest)) {
        imported.push(relative)
      } else {
        skipped.push({ path: relative, reason: '扩展名不可 ingest' })
      }
    } catch (error) {
      console.error('[source-lifecycle] copy failed', absolute, error)
      skipped.push({
        path: absolute,
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { imported, skipped }
}

async function stripSourceRefsFromWiki(
  rootPath: string,
  sourceRelative: string
): Promise<string[]> {
  const wikiDir = joinPath(rootPath, 'wiki')
  if (!(await exists(wikiDir))) return []
  const needle = sourceRelative.replace(/\\/g, '/')
  const removedPages: string[] = []
  const files = await walkFiles(wikiDir)

  for (const absolute of files) {
    if (!/\.md$/i.test(absolute)) continue
    let content: string
    try {
      content = await readTextFile(absolute)
    } catch (error) {
      console.warn('[source-lifecycle] skip unreadable', absolute, error)
      continue
    }
    if (!content.includes(needle)) continue

    const relative = toPosixRelative(rootPath, absolute)
    const fm = content.match(/^---\s*\n([\s\S]*?)\n---/)
    const sourcesLine = fm?.[1]?.match(/^sources:\s*\[([^\]]*)\]/m)
    const onlyThisSource =
      sourcesLine?.[1] &&
      !sourcesLine[1].includes(',') &&
      sourcesLine[1].includes(needle)

    if (onlyThisSource || /type:\s*source\b/i.test(fm?.[1] ?? '')) {
      try {
        await remove(absolute)
        removedPages.push(relative)
        void removePageEmbedding(relative).catch(function (error) {
          console.warn('[source-lifecycle] embed remove failed', relative, error)
        })
      } catch (error) {
        console.error('[source-lifecycle] delete wiki page failed', absolute, error)
      }
      continue
    }

    const next = content.replace(
      new RegExp(`\\s*["']${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']\\s*,?`, 'g'),
      ''
    )
    if (next !== content) {
      try {
        await writeTextFile(absolute, next)
      } catch (error) {
        console.error('[source-lifecycle] rewrite wiki failed', absolute, error)
      }
    }
  }
  return removedPages
}

async function deleteSourceCascade(input: {
  rootPath: string
  sourceRelative: string
}): Promise<{ removedWiki: string[] }> {
  const relative = input.sourceRelative.replace(/\\/g, '/')
  const absolute = joinPath(input.rootPath, relative)

  removeFromIngestCache(relative)
  void removeParsedMarkdown(input.rootPath, relative).catch(function (error) {
    console.warn('[source-lifecycle] parsed cleanup failed', error)
  })

  let removedWiki: string[] = []
  try {
    removedWiki = await stripSourceRefsFromWiki(input.rootPath, relative)
  } catch (error) {
    console.error('[source-lifecycle] strip refs failed', error)
  }

  const mediaHint = findFileName(relative).replace(/\.[^.]+$/, '')
  const mediaDir = joinPath(joinPath(input.rootPath, 'wiki/media'), mediaHint)
  try {
    if (await exists(mediaDir)) {
      await remove(mediaDir, { recursive: true })
    }
  } catch (error) {
    console.warn('[source-lifecycle] media cleanup failed', mediaDir, error)
  }

  try {
    if (await exists(absolute)) {
      await remove(absolute, { recursive: true })
    }
  } catch (error) {
    console.error('[source-lifecycle] delete source failed', absolute, error)
    throw error
  }

  return { removedWiki }
}

function findSourceStatus(
  relative: string,
  queueItems: { path: string; status: string }[]
): 'queued' | 'running' | 'done' | 'failed' | 'blocked' | 'idle' {
  const q = queueItems.find(function (item) {
    return item.path.replace(/\\/g, '/') === relative.replace(/\\/g, '/')
  })
  if (q) {
    if (q.status === 'pending') return 'queued'
    if (q.status === 'running') return 'running'
    if (q.status === 'failed') return 'failed'
    if (q.status === 'blocked') return 'blocked'
    if (q.status === 'succeeded' || q.status === 'skipped') return 'done'
  }
  if (findCacheByPath(relative)) return 'done'
  return 'idle'
}

export {
  INGESTABLE_SOURCE_EXTENSIONS,
  deleteSourceCascade,
  findSourceStatus,
  importFolderToSources,
  isIngestableSourcePath
}
export type { ImportFolderResult }
