/**
 * 定时导入：按配置扫描目录，拷入 raw/sources 并入队。
 */
import { copyFile, exists, mkdir, readDir } from '@tauri-apps/plugin-fs'

import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'
import { findFileName, joinPath } from '@/views/knowledge/lib/path.ts'
import { isIngestableSourcePath } from '@/views/knowledge/lib/source-lifecycle.ts'
import {
  readScheduledImportConfig
} from '@/views/knowledge/lib/scheduled-import-config.ts'
import { WIKI_DIR_RAW_SOURCES } from '@/views/knowledge/lib/wiki-scaffold.ts'

let timer: ReturnType<typeof setInterval> | null = null

async function runScheduledImportOnce(rootPath: string): Promise<number> {
  const config = readScheduledImportConfig()
  if (!config.enabled || !config.path.trim()) return 0
  const sourceDir = config.path.trim()
  if (!(await exists(sourceDir))) {
    console.warn('[scheduled-import] path missing', sourceDir)
    return 0
  }
  const destRoot = joinPath(joinPath(rootPath, WIKI_DIR_RAW_SOURCES), 'scheduled')
  if (!(await exists(destRoot))) await mkdir(destRoot, { recursive: true })

  const entries = await readDir(sourceDir)
  let count = 0
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const absolute = joinPath(sourceDir, entry.name)
    if (!isIngestableSourcePath(absolute)) continue
    const dest = joinPath(destRoot, findFileName(absolute))
    try {
      await copyFile(absolute, dest)
      useIngestQueueStore
        .getState()
        .enqueue(`${WIKI_DIR_RAW_SOURCES}/scheduled/${findFileName(absolute)}`)
      count += 1
    } catch (error) {
      console.error('[scheduled-import] copy failed', absolute, error)
    }
  }
  return count
}

type FindRoot = () => string | null

let findRootPath: FindRoot | null = null

function bootstrapScheduledImport(findRoot: FindRoot): void {
  findRootPath = findRoot
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  const config = readScheduledImportConfig()
  if (!config.enabled) return
  const intervalMs = Math.max(60_000, (config.intervalMinutes || 60) * 60_000)
  timer = setInterval(function () {
    const root = findRoot()
    if (!root) return
    void runScheduledImportOnce(root).catch(function (error) {
      console.error('[scheduled-import] tick failed', error)
    })
  }, intervalMs)
}

/** 设置变更后重挂定时器（保留上次注册的 findRoot）。 */
function refreshScheduledImport(): void {
  if (!findRootPath) return
  bootstrapScheduledImport(findRootPath)
}

export {
  bootstrapScheduledImport,
  refreshScheduledImport,
  runScheduledImportOnce
}
