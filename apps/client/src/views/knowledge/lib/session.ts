import { toast } from 'sonner'

import { useKnowledgeStore } from '@/stores/knowledge'
import { isLargeMarkdown, writeBackup } from '@/views/knowledge/lib/backup.ts'
import {
  findDefaultRoot,
  findDisplayTitle,
  pickOpenMarkdown,
  pickRootDirectory,
  pickSaveMarkdown,
  readMarkdownFile,
  writeMarkdownFile
} from '@/views/knowledge/lib/fs.ts'
import { parseMarkdown } from '@/views/knowledge/lib/parse-markdown.ts'
import { findOutlineFromMarkdown } from '@/views/knowledge/lib/outline.ts'
import { findParentDir, isPathInsideRoot } from '@/views/knowledge/lib/path.ts'
import { serializeHtmlToMarkdown } from '@/views/knowledge/lib/serialize-markdown.ts'
import { findDocStats } from '@/views/knowledge/lib/stats.ts'
import { t } from '@/views/knowledge/locale.ts'

async function ensureRootDir(): Promise<string> {
  const store = useKnowledgeStore.getState()
  if (store.rootDir) return store.rootDir
  const root = await findDefaultRoot()
  store.toPatchPreferences({ rootDir: root })
  return root
}

function syncDerived(markdown: string): void {
  const store = useKnowledgeStore.getState()
  store.toUpdateStats(findDocStats(markdown))
  store.toUpdateOutline(findOutlineFromMarkdown(markdown))
}

function syncWorkspaceRootForFile(path: string): void {
  const store = useKnowledgeStore.getState()
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

async function openPath(path: string, options: { force?: boolean } = {}): Promise<boolean> {
  const store = useKnowledgeStore.getState()
  const same = isSamePath(store.activePath, path)
  if (same && !options.force && !store.isDirty && !store.isLoading) {
    return true
  }

  const sequence = ++openSequence
  // 强制重载同一文件时不闪 loading、不清 dirty（由调用方保证）
  if (!same) {
    store.toBeginOpen(path)
  } else if (options.force && !store.isDirty) {
    store.toSetLoading(true)
  }

  try {
    const raw = await readMarkdownFile(path)
    if (sequence !== openSequence) return false

    // 自身写入触发的 watch：内容未变则跳过，避免编辑器跳动
    if (same && options.force && raw === store.markdown && !store.isDirty) {
      store.toSetLoading(false)
      return true
    }

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
      useKnowledgeStore.getState().toPushRecent(path)
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
  const store = useKnowledgeStore.getState()
  store.toPatchPreferences({ rootDir: selected })
  store.toBumpTree()
  if (!store.hasOpened) {
    store.toNewDocument()
  }
  return true
}

function createUntitled(): void {
  const store = useKnowledgeStore.getState()
  store.toNewDocument()
  syncDerived('')
}

function findCurrentMarkdown(liveHtml?: string): string {
  const store = useKnowledgeStore.getState()
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
  const store = useKnowledgeStore.getState()
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
    const wasUntitled = !store.activePath || Boolean(options?.saveAs)
    await writeMarkdownFile(path, content)
    store.toUpdateMarkdown(content)
    store.toMarkSaved(path)
    syncDerived(content)
    store.toPushRecent(path)
    syncWorkspaceRootForFile(path)
    if (wasUntitled) {
      store.toBumpTree()
    }
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
  const store = useKnowledgeStore.getState()
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
