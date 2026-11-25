/**
 * Ingest 写盘副作用：log / overview + 触发 rescan 与 Rust 侧 index 重建。
 *
 * 聚合页由应用维护，禁止模型生成。index 的格式只有 Rust `knowledge::wiki_index`
 * 一份实现：这里不再拼条目，写完页面后重建整份 index。
 */
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { toast } from 'sonner'

import { POST_KNOWLEDGE_REBUILD_INDEX } from '@/apis/knowledge'
import { useSpacesStore } from '@/stores/spaces'
import { findParentDir, joinPath } from '@/views/knowledge/lib/path.ts'

const LOG_SEED = '---\ntitle: Log\ntype: log\n---\n\n# Log\n\n## 操作记录\n\n'
const OVERVIEW_SEED =
  '---\ntitle: Overview\ntype: overview\n---\n\n# Overview\n\n全局概要，随 ingest 更新。\n\n## 最近摄入\n\n'

async function ensureParent(absolute: string): Promise<void> {
  const parent = findParentDir(absolute)
  if (!parent) return
  if (!(await exists(parent))) {
    await mkdir(parent, { recursive: true })
  }
}

async function readOrSeed(absolute: string, seed: string): Promise<string> {
  if (await exists(absolute)) {
    return readTextFile(absolute)
  }
  await ensureParent(absolute)
  await writeTextFile(absolute, seed)
  return seed
}

async function appendIngestLog(root: string, line: string): Promise<void> {
  const logPath = joinPath(root, 'wiki/log.md')
  const existing = await readOrSeed(logPath, LOG_SEED)
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
  await writeTextFile(logPath, `${existing.trimEnd()}\n- ${stamp} ${line}\n`)
}

async function touchOverview(root: string, title: string): Promise<void> {
  const path = joinPath(root, 'wiki/overview.md')
  let existing = await readOrSeed(path, OVERVIEW_SEED)
  if (!/## 最近摄入/.test(existing)) {
    existing = `${existing.trimEnd()}\n\n## 最近摄入\n\n`
  }
  if (existing.includes(`[[${title}]]`)) return
  const stamp = new Date().toISOString().slice(0, 10)
  await writeTextFile(path, `${existing.trimEnd()}\n- ${stamp} [[${title}]]\n`)
}

/** 写盘成功后刷新 FTS；失败只告警不回滚 */
async function rescanAfterIngest(): Promise<void> {
  try {
    await useSpacesStore.getState().rescan()
  } catch (error) {
    console.error('[ingest] rescan after write failed', error)
    toast.warning('Wiki 已写入，但索引刷新失败，可在设置中手动重新扫描')
  }
}

/** 先回灌再让 Rust 整份重建 index（顺序不能反：重建读的是库内文档） */
async function rebuildIndexAfterIngest(spaceId: string | null | undefined): Promise<void> {
  if (!spaceId) return
  try {
    await POST_KNOWLEDGE_REBUILD_INDEX(spaceId)
  } catch (error) {
    console.error('[ingest] rebuild index failed', error)
    toast.warning('Wiki 已写入，但 wiki/index.md 重建失败，可在设置 → 维护中重试')
  }
}

async function maintainAfterPages(
  root: string,
  pages: { title: string; wikiRelative: string; sourceRelative: string }[],
  spaceId?: string | null
): Promise<void> {
  for (const page of pages) {
    await appendIngestLog(root, `ingest [[${page.title}]] ← \`${page.sourceRelative}\``)
    await touchOverview(root, page.title)
  }
  await rescanAfterIngest()
  await rebuildIndexAfterIngest(spaceId)
}

export {
  appendIngestLog,
  maintainAfterPages,
  rebuildIndexAfterIngest,
  rescanAfterIngest,
  touchOverview
}
