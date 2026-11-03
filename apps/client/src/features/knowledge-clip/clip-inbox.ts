/**
 * 接收剪藏事件并写入当前库 `raw/sources/`。
 */
import { listen } from '@tauri-apps/api/event'
import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs'

import type { KnowledgeClipPayload } from '@/features/knowledge-clip/server.ts'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'
import { joinPath } from '@/views/knowledge/lib/path.ts'
import { WIKI_DIR_RAW_SOURCES } from '@/views/knowledge/lib/wiki-scaffold.ts'

const CLIP_EVENT = 'knowledge://clip'

let clipBootstrap: Promise<void> | null = null

function slugFromTitle(title: string): string {
  const trimmed = title.trim().slice(0, 64)
  const slug = trimmed
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `clip-${Date.now()}`
}

async function writeClipMarkdown(payload: KnowledgeClipPayload): Promise<string> {
  const bases = useKnowledgeBaseStore.getState().bases
  const activeId = useKnowledgeBaseStore.getState().activeBaseID
  const base = bases.find(function (b) {
    return b.id === activeId
  })
  const root = base?.rootPath
  if (!root) {
    throw new Error('无活动知识库，无法写入剪藏')
  }

  const fileName = `${slugFromTitle(payload.title)}.md`
  const relative = `${WIKI_DIR_RAW_SOURCES}/${fileName}`
  const absolute = joinPath(root, relative)
  const dir = joinPath(root, WIKI_DIR_RAW_SOURCES)
  const hasDir = await exists(dir)
  if (!hasDir) {
    await mkdir(dir, { recursive: true })
  }

  const front = `---
title: ${JSON.stringify(payload.title)}
source: ${JSON.stringify(payload.url)}
type: source
---

`
  const body = payload.markdown.trim() || payload.title
  await writeTextFile(absolute, `${front}${body}\n`)
  useIngestQueueStore.getState().enqueue(relative)
  return relative
}

async function bootstrapClipInbox(): Promise<void> {
  if (clipBootstrap) return clipBootstrap
  clipBootstrap = listen<KnowledgeClipPayload>(CLIP_EVENT, function (event) {
    void writeClipMarkdown(event.payload).catch(function (error) {
      console.error('[knowledge/clip] 落盘失败', error)
    })
  }).then(function () {
    return undefined
  })
  return clipBootstrap
}

export { CLIP_EVENT, bootstrapClipInbox, writeClipMarkdown }
