import { open } from '@tauri-apps/plugin-dialog'
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  stat,
  writeTextFile,
  type DirEntry
} from '@tauri-apps/plugin-fs'

import { MAX_OPEN_BYTES, hasBinaryExtension, looksBinary } from '@/views/code/lib/file-limits.ts'
import {
  findFileName,
  findParentDir,
  isPathInsideRoot,
  isSamePath,
  joinPath,
  normalizeSeparators
} from '@/views/code/lib/path.ts'

async function readCodeFile(path: string): Promise<string> {
  if (hasBinaryExtension(path)) {
    throw new Error('这是二进制文件，无法在编辑器中打开')
  }
  // 先看体量，避免把超大文件整份读进内存
  const info = await stat(path)
  if (info.size > MAX_OPEN_BYTES) {
    throw new Error('文件过大，无法在编辑器中打开')
  }
  const content = await readTextFile(path)
  if (looksBinary(content)) {
    throw new Error('这是二进制文件，无法在编辑器中打开')
  }
  return content
}

async function writeCodeFile(path: string, content: string): Promise<void> {
  await writeTextFile(path, content)
}

async function pickRootDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    // 必须递归授权：否则只能列根目录，子目录操作会 forbidden
    recursive: true
  })
  if (!selected || Array.isArray(selected)) return null
  return selected
}

async function pickOpenFile(): Promise<string | null> {
  const selected = await open({
    multiple: false
  })
  if (!selected || Array.isArray(selected)) return null
  return selected
}

interface TreeEntry {
  name: string
  path: string
  isDirectory: boolean
}

async function listWorkspaceEntries(
  root: string,
  relative: string,
  options: { isHiddenVisible?: boolean } = {}
): Promise<TreeEntry[]> {
  const absolute = relative ? joinPath(root, relative) : root
  if (!isPathInsideRoot(root, absolute)) {
    throw new Error('Path escapes workspace root')
  }
  const entries: DirEntry[] = await readDir(absolute)
  const mapped: TreeEntry[] = []
  for (const entry of entries) {
    if (!options.isHiddenVisible && entry.name.startsWith('.')) continue
    mapped.push({
      name: entry.name,
      path: relative ? `${relative}/${entry.name}` : entry.name,
      isDirectory: Boolean(entry.isDirectory)
    })
  }
  mapped.sort(function (a, b) {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  return mapped
}

interface SearchHit {
  name: string
  relative: string
  absolute: string
}

/** 浅层文件名搜索（最多 depth 层，结果上限 limit） */
async function searchWorkspaceFiles(params: {
  root: string
  query: string
  depth?: number
  limit?: number
  isHiddenVisible?: boolean
}): Promise<SearchHit[]> {
  const query = params.query.trim().toLowerCase()
  if (!query) return []
  const maxDepth = params.depth ?? 4
  const limit = params.limit ?? 80
  const hits: SearchHit[] = []

  async function walk(relative: string, depth: number): Promise<void> {
    if (hits.length >= limit || depth > maxDepth) return
    let entries: TreeEntry[]
    try {
      entries = await listWorkspaceEntries(params.root, relative, {
        isHiddenVisible: params.isHiddenVisible
      })
    } catch (error) {
      console.debug('[code] skip unreadable dir', relative, error)
      return
    }
    for (const entry of entries) {
      if (hits.length >= limit) return
      if (entry.isDirectory) {
        await walk(entry.path, depth + 1)
        continue
      }
      if (entry.name.toLowerCase().includes(query)) {
        hits.push({
          name: entry.name,
          relative: entry.path,
          absolute: joinPath(params.root, entry.path)
        })
      }
    }
  }

  await walk('', 0)
  return hits
}

async function insertCodeFile(root: string, relativeDir: string, name: string): Promise<string> {
  const fileName = name.trim().replace(/[/\\]/g, '')
  if (!fileName) throw new Error('Empty file name')
  const relative = relativeDir ? `${relativeDir}/${fileName}` : fileName
  const absolute = joinPath(root, relative)
  if (!isPathInsideRoot(root, absolute)) {
    throw new Error('Path escapes workspace root')
  }
  const parent = relativeDir ? joinPath(root, relativeDir) : root
  const hasParent = await exists(parent)
  if (!hasParent) {
    await mkdir(parent, { recursive: true })
  }
  const already = await exists(absolute)
  if (already) {
    throw new Error('文件已存在')
  }
  await writeTextFile(absolute, '')
  return absolute
}

async function insertCodeFolder(root: string, relativeDir: string, name: string): Promise<string> {
  const folderName = name.trim().replace(/[/\\]/g, '')
  if (!folderName) throw new Error('Empty folder name')
  const relative = relativeDir ? `${relativeDir}/${folderName}` : folderName
  const absolute = joinPath(root, relative)
  if (!isPathInsideRoot(root, absolute)) {
    throw new Error('Path escapes workspace root')
  }
  await mkdir(absolute, { recursive: false })
  return absolute
}

async function renameCodePath(fromPath: string, toPath: string, root: string): Promise<void> {
  if (!isPathInsideRoot(root, fromPath) || !isPathInsideRoot(root, toPath)) {
    throw new Error('Path escapes workspace root')
  }
  if (isSamePath(fromPath, toPath)) return
  await rename(fromPath, toPath)
}

async function removeCodePath(
  path: string,
  root: string,
  options: { recursive?: boolean } = {}
): Promise<void> {
  if (!isPathInsideRoot(root, path)) {
    throw new Error('Path escapes workspace root')
  }
  await remove(path, { recursive: options.recursive ?? false })
}

export {
  readCodeFile,
  writeCodeFile,
  pickRootDirectory,
  pickOpenFile,
  listWorkspaceEntries,
  searchWorkspaceFiles,
  insertCodeFile,
  insertCodeFolder,
  renameCodePath,
  removeCodePath,
  findFileName,
  findParentDir,
  normalizeSeparators,
  joinPath,
  isPathInsideRoot,
  isSamePath
}
export type { TreeEntry, SearchHit }
