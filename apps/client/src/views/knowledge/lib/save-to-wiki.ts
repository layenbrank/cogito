/**
 * 把对话/调研产物显式存回 wiki（经 staging 或直接写路径由调用方决定）。
 */
import { writeTextFile, mkdir, exists } from '@tauri-apps/plugin-fs'

import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'
import { findParentDir, joinPath } from '@/views/knowledge/lib/path.ts'

function slugifyTitle(title: string): string {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.slice(0, 48) || `note-${Date.now()}`
}

async function saveMarkdownToWiki(input: {
  rootPath: string
  title: string
  markdown: string
  enqueueIngest?: boolean
}): Promise<string> {
  const relative = `wiki/${slugifyTitle(input.title)}.md`
  const absolute = joinPath(input.rootPath, relative)
  const parent = findParentDir(absolute)
  if (parent && !(await exists(parent))) {
    await mkdir(parent, { recursive: true })
  }
  const body = input.markdown.includes('---\n')
    ? input.markdown
    : `---\ntitle: "${input.title.replace(/"/g, '\\"')}"\ntype: note\n---\n\n${input.markdown}\n`
  await writeTextFile(absolute, body)
  if (input.enqueueIngest) {
    useIngestQueueStore.getState().enqueue(relative)
  }
  return absolute
}

export { saveMarkdownToWiki, slugifyTitle }
