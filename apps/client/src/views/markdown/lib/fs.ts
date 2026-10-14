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

interface TreeEntry {
  name: string
  path: string
  isDirectory: boolean
}

async function listMarkdownEntries(
  root: string,
  relative: string
): Promise<TreeEntry[]> {
  const absolute = relative ? joinPath(root, relative) : root
  if (!isPathInsideRoot(root, absolute)) {
    throw new Error('Path escapes workspace root')
  }
  const entries: DirEntry[] = await readDir(absolute)
  const mapped: TreeEntry[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory) {
      mapped.push({
        name: entry.name,
        path: relative ? `${relative}/${entry.name}` : entry.name,
        isDirectory: true
      })
      continue
    }
    if (isMarkdownName(entry.name)) {
      mapped.push({
        name: entry.name,
        path: relative ? `${relative}/${entry.name}` : entry.name,
        isDirectory: false
      })
    }
  }
  mapped.sort(function (a, b) {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  return mapped
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

export type { TreeEntry }
