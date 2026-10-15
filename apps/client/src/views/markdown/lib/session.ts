import { toast } from 'sonner'

import { useMarkdownStore } from '@/stores/markdown'
import { isLargeMarkdown, writeBackup } from '@/views/markdown/lib/backup.ts'
import {
  findDefaultRoot,
  findDisplayTitle,
  pickOpenMarkdown,
  pickRootDirectory,
  pickSaveMarkdown,
  readMarkdownFile,
  writeMarkdownFile
} from '@/views/markdown/lib/fs.ts'
import { parseMarkdown } from '@/views/markdown/lib/parse-markdown.ts'
import { findOutlineFromMarkdown } from '@/views/markdown/lib/outline.ts'
import { findParentDir, isPathInsideRoot } from '@/views/markdown/lib/path.ts'
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

function syncWorkspaceRootForFile(path: string): void {
  const store = useMarkdownStore.getState()
  if (store.rootDir && isPathInsideRoot(store.rootDir, path)) return
  const parent = findParentDir(path)
  store.toPatchPreferences({ rootDir: parent })
  store.toBumpTree()
}

function isSamePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

/** 防止快速连续打开时，较慢的旧请求覆盖新文档 */
let openSequence = 0

async function openPath(path: string): Promise<boolean> {
  const store = useMarkdownStore.getState()
  if (isSamePath(store.activePath, path) && !store.isDirty && !store.isLoading) {
    return true
  }

  const sequence = ++openSequence
  // 先切高亮，让侧栏立刻响应
  store.toBeginOpen(path)

  try {
    const raw = await readMarkdownFile(path)
    if (sequence !== openSequence) return false

    const parsed = parseMarkdown(raw)
    const large = isLargeMarkdown(raw)
    store.toOpenDocument({
      path,
      markdown: raw,
      frontMatter: parsed.frontMatter,
      html: parsed.html,
      isLargeFile: large
    })
    syncWorkspaceRootForFile(path)
    requestAnimationFrame(function () {
      if (sequence !== openSequence) return
      syncDerived(raw)
      useMarkdownStore.getState().toPushRecent(path)
    })
    if (large) {
      toast.message(t('LARGE_FILE_WARN'))
    }
    return true
  } catch (error) {
    if (sequence !== openSequence) return false
    console.error('[markdown] open failed', error)
    store.toSetLoading(false)
    toast.error(t('OPEN_FAILED'))
    return false
  }
}

async function openWithDialog(): Promise<boolean> {
  const path = await pickOpenMarkdown()
  if (!path) return false
  return openPath(path)
}

/**
 * 将目录设为工作区根。若尚未进入编辑态则打开空白文档以便显示侧栏。
 */
async function openFolderAsWorkspace(dir?: string | null): Promise<boolean> {
  const selected = dir ?? (await pickRootDirectory())
  if (!selected) return false
  const store = useMarkdownStore.getState()
  store.toPatchPreferences({ rootDir: selected })
  store.toBumpTree()
  if (!store.hasOpened) {
    store.toNewDocument()
  }
  return true
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
    syncWorkspaceRootForFile(path)
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
  openFolderAsWorkspace,
  createUntitled,
  findCurrentMarkdown,
  saveDocument,
  confirmIfDirty,
  findDisplayTitle,
  syncDerived
}
