import { toast } from 'sonner'

import { useMarkdownStore } from '@/stores/markdown'
import { isLargeMarkdown, writeBackup } from '@/views/markdown/lib/backup.ts'
import {
  findDefaultRoot,
  findDisplayTitle,
  pickOpenMarkdown,
  pickSaveMarkdown,
  readMarkdownFile,
  writeMarkdownFile
} from '@/views/markdown/lib/fs.ts'
import { parseMarkdown } from '@/views/markdown/lib/parse-markdown.ts'
import { findOutlineFromMarkdown } from '@/views/markdown/lib/outline.ts'
import { serializeHtmlToMarkdown } from '@/views/markdown/lib/serialize-markdown.ts'
import { findDocStats } from '@/views/markdown/lib/stats.ts'
import { t } from '@/views/markdown/locale.ts'

async function ensureRootDir(): Promise<string> {
  const store = useMarkdownStore.getState()
  if (store.rootDir) return store.rootDir
  const root = await findDefaultRoot()
  store.toPatchPreferences({ rootDir: root })
  return root
}

function syncDerived(markdown: string): void {
  const store = useMarkdownStore.getState()
  store.toUpdateStats(findDocStats(markdown))
  store.toUpdateOutline(findOutlineFromMarkdown(markdown))
}

async function openPath(path: string): Promise<boolean> {
  const store = useMarkdownStore.getState()
  try {
    const raw = await readMarkdownFile(path)
    const parsed = parseMarkdown(raw)
    const large = isLargeMarkdown(raw)
    store.toOpenDocument({
      path,
      markdown: raw,
      frontMatter: parsed.frontMatter,
      html: parsed.html,
      isLargeFile: large
    })
    syncDerived(raw)
    store.toPushRecent(path)
    if (large) {
      toast.message(t('LARGE_FILE_WARN'))
    }
    return true
  } catch (error) {
    console.error('[markdown] open failed', error)
    toast.error(t('OPEN_FAILED'))
    return false
  }
}

async function openWithDialog(): Promise<boolean> {
  const path = await pickOpenMarkdown()
  if (!path) return false
  return openPath(path)
}

function createUntitled(): void {
  const store = useMarkdownStore.getState()
  store.toNewDocument()
  syncDerived('')
}

function findCurrentMarkdown(liveHtml?: string): string {
  const store = useMarkdownStore.getState()
  if (store.viewMode === 'source') {
    return store.markdown
  }
  const html = liveHtml ?? store.html
  return serializeHtmlToMarkdown(html, store.frontMatter)
}

async function saveDocument(options?: {
  saveAs?: boolean
  liveHtml?: string
}): Promise<boolean> {
  const store = useMarkdownStore.getState()
  const content = findCurrentMarkdown(options?.liveHtml)
  try {
    let path = store.activePath
    if (!path || options?.saveAs) {
      const suggested = path
        ? path.split(/[/\\]/).pop() ?? 'untitled.md'
        : 'untitled.md'
      path = await pickSaveMarkdown(suggested)
      if (!path) return false
    }
    await writeMarkdownFile(path, content)
    store.toUpdateMarkdown(content)
    store.toMarkSaved(path)
    syncDerived(content)
    store.toPushRecent(path)
    void writeBackup(path, content).catch(function () {
      /* ignore backup errors */
    })
    return true
  } catch (error) {
    console.error('[markdown] save failed', error)
    toast.error(t('SAVE_FAILED'))
    return false
  }
}

async function confirmIfDirty(
  ask: () => Promise<'save' | 'discard' | 'cancel'>
): Promise<boolean> {
  const store = useMarkdownStore.getState()
  if (!store.isDirty) return true
  const choice = await ask()
  if (choice === 'cancel') return false
  if (choice === 'discard') return true
  return saveDocument()
}

export {
  ensureRootDir,
  openPath,
  openWithDialog,
  createUntitled,
  findCurrentMarkdown,
  saveDocument,
  confirmIfDirty,
  findDisplayTitle,
  syncDerived
}
