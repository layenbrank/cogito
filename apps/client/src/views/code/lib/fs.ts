import { open } from '@tauri-apps/plugin-dialog'
import { readDir, readTextFile, writeTextFile, type DirEntry } from '@tauri-apps/plugin-fs'

import {
  findFileName,
  isPathInsideRoot,
  joinPath,
  normalizeSeparators
} from '@/views/code/lib/path.ts'

async function readCodeFile(path: string): Promise<string> {
  return readTextFile(path)
}

async function writeCodeFile(path: string, content: string): Promise<void> {
  await writeTextFile(path, content)
}

async function pickRootDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false
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

async function listWorkspaceEntries(root: string, relative: string): Promise<TreeEntry[]> {
  const absolute = relative ? joinPath(root, relative) : root
  if (!isPathInsideRoot(root, absolute)) {
    throw new Error('Path escapes workspace root')
  }
  const entries: DirEntry[] = await readDir(absolute)
  const mapped: TreeEntry[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
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
      entries = await listWorkspaceEntries(params.root, relative)
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

export {
  readCodeFile,
  writeCodeFile,
  pickRootDirectory,
  pickOpenFile,
  listWorkspaceEntries,
  searchWorkspaceFiles,
  findFileName,
  normalizeSeparators,
  joinPath,
  isPathInsideRoot
}
export type { TreeEntry, SearchHit }
