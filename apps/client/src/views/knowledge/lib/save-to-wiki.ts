/**
 * 把对话/调研产物显式存回 wiki（经 staging 或直接写路径由调用方决定）。
 */
import { writeTextFile, mkdir, exists } from '@tauri-apps/plugin-fs'

import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'
import { findParentDir, joinPath } from '@/views/knowledge/lib/path.ts'
import { buildTypedWikiPath } from '@/views/knowledge/lib/wiki-type-dirs.ts'

async function saveMarkdownToWiki(input: {
  rootPath: string
  title: string
  markdown: string
  enqueueIngest?: boolean
}): Promise<string> {
  // 落点跟 type 走（默认 note → wiki/notes/），与 agent 写入一致
  const relative = buildTypedWikiPath('note', input.title)
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

export { saveMarkdownToWiki }
