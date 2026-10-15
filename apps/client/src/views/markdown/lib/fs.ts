import { documentDir, dirname } from '@tauri-apps/api/path'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
  type DirEntry
} from '@tauri-apps/plugin-fs'

import {
  findFileName,
  isMarkdownName,
  isPathInsideRoot,
  joinPath,
  normalizeSeparators
} from '@/views/markdown/lib/path.ts'

/** 单目录可见条目上限，超出需「加载更多」（对齐 VS Code explorer.fileLimit 思路） */
const TREE_PAGE_SIZE = 200

interface TreeEntry {
  name: string
  path: string
  isDirectory: boolean
}

/** 按绝对路径缓存已排序的目录条目，避免二次展开 / Load more 重复 readDir */
const dirListCache = new Map<string, TreeEntry[]>()

function clearDirListCache(absolutePath?: string): void {
  if (!absolutePath) {
    dirListCache.clear()
    return
  }
  const key = normalizeSeparators(absolutePath).replace(/\/+$/, '')
  dirListCache.delete(key)
}

async function findDefaultRoot(): Promise<string> {
  return documentDir()
}

async function readMarkdownFile(path: string): Promise<string> {
  return readTextFile(path)
}

async function writeMarkdownFile(path: string, content: string): Promise<void> {
  await writeTextFile(path, content)
}

async function pickOpenMarkdown(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] }]
  })
  if (!selected || Array.isArray(selected)) return null
  return selected
}

async function pickSaveMarkdown(suggestedName = 'untitled.md'): Promise<string | null> {
  const target = await save({
    defaultPath: suggestedName,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  return target
}

async function pickRootDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false
  })
  if (!selected || Array.isArray(selected)) return null
  return selected
}

interface ListMarkdownEntriesOptions {
  offset?: number
  limit?: number
  /** 仅在无缓存全量列表上过滤；优先由 UI 对已加载节点做客户端过滤 */
  query?: string
}

interface ListMarkdownEntriesResult {
  entries: TreeEntry[]
  hasMore: boolean
  total: number
}

function mapDirEntry(entry: DirEntry, relative: string): TreeEntry | null {
  if (!entry.name || entry.name.startsWith('.')) return null

  if (entry.isDirectory) {
    return {
      name: entry.name,
      path: relative ? `${relative}/${entry.name}` : entry.name,
      isDirectory: true
    }
  }

  // 仅收录明确文件或带 markdown 扩展名的条目，跳过歧义 symlink 等
  if (entry.isFile || (!entry.isDirectory && isMarkdownName(entry.name))) {
    if (!isMarkdownName(entry.name)) return null
    return {
      name: entry.name,
      path: relative ? `${relative}/${entry.name}` : entry.name,
      isDirectory: false
    }
  }

  return null
}

function findCacheKey(absolute: string): string {
  return normalizeSeparators(absolute).replace(/\/+$/, '')
}

async function findSortedDirEntries(
  root: string,
  relative: string,
  absolute: string
): Promise<TreeEntry[]> {
  const cacheKey = findCacheKey(absolute)
  const cached = dirListCache.get(cacheKey)
  if (cached) return cached

  const dirEntries: DirEntry[] = await readDir(absolute)
  const mapped: TreeEntry[] = []
  for (const entry of dirEntries) {
    const item = mapDirEntry(entry, relative)
    if (item) mapped.push(item)
  }

  mapped.sort(function (a, b) {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })

  dirListCache.set(cacheKey, mapped)
  return mapped
}

async function listMarkdownEntries(
  root: string,
  relative: string,
  options: ListMarkdownEntriesOptions = {}
): Promise<ListMarkdownEntriesResult> {
  const offset = options.offset ?? 0
  const limit = options.limit ?? TREE_PAGE_SIZE
  const query = options.query?.trim().toLowerCase() ?? ''

  const absolute = relative ? joinPath(root, relative) : root
  if (!isPathInsideRoot(root, absolute)) {
    throw new Error('Path escapes workspace root')
  }

  let mapped = await findSortedDirEntries(root, relative, absolute)

  if (query) {
    mapped = mapped.filter(function (item) {
      if (item.isDirectory) return true
      return item.name.toLowerCase().includes(query)
    })
  }

  const total = mapped.length
  const entries = mapped.slice(offset, offset + limit)
  return {
    entries,
    hasMore: offset + entries.length < total,
    total
  }
}

async function createMarkdownFile(root: string, relativeDir: string, name: string): Promise<string> {
  const fileName = isMarkdownName(name) ? name : `${name}.md`
  const relative = relativeDir ? `${relativeDir}/${fileName}` : fileName
  const absolute = joinPath(root, relative)
  if (!isPathInsideRoot(root, absolute)) {
    throw new Error('Path escapes workspace root')
  }
  await writeTextFile(absolute, '# New note\n\n')
  return absolute
}

async function renameMarkdownPath(fromPath: string, toPath: string, root: string): Promise<void> {
  if (!isPathInsideRoot(root, fromPath) || !isPathInsideRoot(root, toPath)) {
    throw new Error('Path escapes workspace root')
  }
  await rename(fromPath, toPath)
}

async function removeMarkdownPath(path: string, root: string): Promise<void> {
  if (!isPathInsideRoot(root, path)) {
    throw new Error('Path escapes workspace root')
  }
  await remove(path)
}

async function ensureAssetsDir(docPath: string): Promise<string> {
  const parent = await dirname(docPath)
  const assets = joinPath(parent, 'assets')
  const hasDir = await exists(assets)
  if (!hasDir) {
    await mkdir(assets, { recursive: true })
  }
  return assets
}

async function writeBinaryBesideDoc(
  docPath: string,
  fileName: string,
  bytes: Uint8Array
): Promise<string> {
  const assets = await ensureAssetsDir(docPath)
  const absolute = joinPath(assets, fileName)
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  await writeFile(absolute, bytes)
  return `assets/${fileName}`
}

function findDisplayTitle(path: string | null, isDirty: boolean): string {
  const name = path ? findFileName(path) : 'Untitled'
  return isDirty ? `${name} *` : name
}

export {
  TREE_PAGE_SIZE,
  clearDirListCache,
  findDefaultRoot,
  readMarkdownFile,
  writeMarkdownFile,
  pickOpenMarkdown,
  pickSaveMarkdown,
  pickRootDirectory,
  listMarkdownEntries,
  createMarkdownFile,
  renameMarkdownPath,
  removeMarkdownPath,
  ensureAssetsDir,
  writeBinaryBesideDoc,
  findDisplayTitle,
  normalizeSeparators
}

export type { TreeEntry, ListMarkdownEntriesOptions, ListMarkdownEntriesResult }
