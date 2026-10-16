import { appDataDir, join } from '@tauri-apps/api/path'
import { mkdir, writeTextFile, readTextFile, exists } from '@tauri-apps/plugin-fs'

import { findFileName } from '@/views/markdown/lib/path.ts'

const LARGE_FILE_BYTES = 2 * 1024 * 1024

async function findBackupDir(): Promise<string> {
  const base = await appDataDir()
  const dir = await join(base, 'markdown-backups')
  const hasDir = await exists(dir)
  if (!hasDir) {
    await mkdir(dir, { recursive: true })
  }
  return dir
}

async function writeBackup(activePath: string | null, content: string): Promise<void> {
  const dir = await findBackupDir()
  const stamp = Date.now()
  const base = activePath ? findFileName(activePath) : 'untitled.md'
  const safe = base.replace(/[^\w.-]+/g, '_')
  const target = await join(dir, `${safe}.${stamp}.bak`)
  await writeTextFile(target, content)
}

async function findLatestBackup(activePath: string | null): Promise<string | null> {
  // 动态导入与目录解析互不依赖，并行发起
  const [{ readDir }, dir] = await Promise.all([
    import('@tauri-apps/plugin-fs'),
    findBackupDir()
  ])
  const base = activePath ? findFileName(activePath) : 'untitled.md'
  const safe = base.replace(/[^\w.-]+/g, '_')
  const entries = await readDir(dir)
  const matches = entries
    .filter(function (entry) {
      return entry.name.startsWith(`${safe}.`) && entry.name.endsWith('.bak')
    })
    .map(function (entry) {
      return entry.name
    })
    .sort()
  const latest = matches[matches.length - 1]
  if (!latest) return null
  const { join: joinPath } = await import('@tauri-apps/api/path')
  const absolute = await joinPath(dir, latest)
  return readTextFile(absolute)
}

function isLargeMarkdown(content: string): boolean {
  return new TextEncoder().encode(content).byteLength >= LARGE_FILE_BYTES
}

export { LARGE_FILE_BYTES, writeBackup, findLatestBackup, isLargeMarkdown }
