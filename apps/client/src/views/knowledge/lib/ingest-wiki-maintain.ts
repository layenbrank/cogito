/**
 * Ingest 写盘副作用：log / overview / index + 触发知识库 rescan。
 * 聚合页由应用维护，禁止模型生成。
 */
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { toast } from 'sonner'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { findParentDir, joinPath } from '@/views/knowledge/lib/path.ts'

const INDEX_SEED =
  '---\ntitle: Index\ntype: index\n---\n\n# Index\n\n内容目录。ingest 后由助手维护。\n\n## Pages\n\n'
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

async function upsertIndexEntry(
  root: string,
  title: string,
  wikiRelative: string
): Promise<void> {
  const path = joinPath(root, 'wiki/index.md')
  let existing = await readOrSeed(path, INDEX_SEED)
  if (!/## Pages/.test(existing)) {
    existing = `${existing.trimEnd()}\n\n## Pages\n\n`
  }
  const bullet = `- [[${title}]] (\`${wikiRelative.replace(/\\/g, '/')}\`)`
  if (existing.includes(`[[${title}]]`)) return
  await writeTextFile(path, `${existing.trimEnd()}\n${bullet}\n`)
}

/** 写盘成功后刷新 FTS；失败只告警不回滚 */
async function rescanAfterIngest(): Promise<void> {
  try {
    await useKnowledgeBaseStore.getState().rescan()
  } catch (error) {
    console.error('[ingest] rescan after write failed', error)
    toast.warning('Wiki 已写入，但索引刷新失败，可在设置中手动重新扫描')
  }
}

async function maintainAfterPages(
  root: string,
  pages: { title: string; wikiRelative: string; sourceRelative: string }[]
): Promise<void> {
  for (const page of pages) {
    await appendIngestLog(root, `ingest [[${page.title}]] ← \`${page.sourceRelative}\``)
    await touchOverview(root, page.title)
    await upsertIndexEntry(root, page.title, page.wikiRelative)
  }
  await rescanAfterIngest()
}

export {
  appendIngestLog,
  maintainAfterPages,
  rescanAfterIngest,
  touchOverview,
  upsertIndexEntry
}
