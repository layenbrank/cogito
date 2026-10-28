import { exists } from '@tauri-apps/plugin-fs'
import { toast } from 'sonner'

import { listBases, resolveDoc, writeDoc } from '@/lib/knowledge-ipc'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useKnowledgeStore } from '@/stores/knowledge'
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
import { findDocStats, isLargeMarkdown } from '@/views/knowledge/lib/stats.ts'
import { t } from '@/views/knowledge/locale.ts'

/**
 * 工作区根目录 = **当前知识库的目录**。
 *
 * 以前这是个独立偏好，用户可能在设置里选一个与库无关的文件夹，于是侧栏文件树、
 * 库列表、保存落库三者的「根」各说各话。现在根只由库决定：有库就用库目录，
 * 一个库都没有（首次启动、库目录被删）才回落到老的应用数据目录。
 */
async function ensureRootDir(): Promise<string> {
  const store = useKnowledgeStore.getState()
  if (store.rootDir) return store.rootDir
  const root = await findActiveBaseRoot()
  store.toSetRootDir(root)
  return root
}

async function findActiveBaseRoot(): Promise<string> {
  try {
    const bases = await listBases()
    const active = bases.find(function (base) {
      return base.id === useKnowledgeBaseStore.getState().activeBaseID
    })
    const picked = active ?? bases[0]
    if (picked?.rootPath) return picked.rootPath
  } catch (error) {
    console.warn('[knowledge] 读取知识库目录失败，回落到默认目录:', error)
  }
  return findDefaultRoot()
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
  store.toSetRootDir(parent)
  store.toBumpTree()
}

function isSamePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

/** 打开后取库内引用（含 hash）：保存时用它判断「期间是否被别人改过」 */
async function syncActiveDoc(path: string): Promise<void> {
  try {
    const reference = await resolveDoc(path)
    const store = useKnowledgeStore.getState()
    // 期间可能已经切到别的文档
    if (!isSamePath(store.activePath, path)) return
    store.toSetActiveDoc(reference.matched ? reference : null)
  } catch (error) {
    console.warn('[knowledge] 解析文档引用失败:', error)
  }
}

/** 防止快速连续打开时，较慢的旧请求覆盖新文档 */
let openSequence = 0

/** 首屏 hydrate + 恢复上次文件：单例，避免壳与 lazy 工作区重复跑 */
let sessionBootstrap: Promise<void> | null = null

/**
 * 知识库首屏引导：灌入偏好、定工作区根、尝试打开最近文件。
 * 可在壳层尽早调用，不必等 lazy 编辑器 chunk。
 */
async function bootstrapKnowledgeSession(search = ''): Promise<void> {
  if (!sessionBootstrap) {
    sessionBootstrap = runSessionBootstrap()
  }
  await sessionBootstrap
  const url = new URLSearchParams(search).get('url')
  if (!url) return
  await openPath(decodeURIComponent(url))
}

async function runSessionBootstrap(): Promise<void> {
  const store = useKnowledgeStore.getState()
  try {
    await store.hydrateFromStore()
    await ensureRootDir()
    const state = useKnowledgeStore.getState()
    if (state.hasOpened) return
    for (const path of state.recentPaths) {
      const opened = await openPath(path)
      if (opened) break
    }
  } catch (error) {
    console.warn('[knowledge] session bootstrap failed:', error)
  } finally {
    useKnowledgeStore.getState().toMarkSessionReady()
  }
}

async function openPath(path: string, options: { force?: boolean } = {}): Promise<boolean> {
  const store = useKnowledgeStore.getState()
  const same = isSamePath(store.activePath, path)
  if (same && !options.force && !store.isDirty && !store.isLoading) {
    return true
  }

  // 缺失路径不要 toBeginOpen：否则 hasOpened=true 却灌不进内容，主栏整片空白
  if (!same) {
    try {
      const isPresent = await exists(path)
      if (!isPresent) {
        console.warn('[markdown] open skipped, missing path:', path)
        return false
      }
    } catch (error) {
      console.warn('[markdown] exists check failed:', path, error)
    }
  }

  const sequence = ++openSequence
  const wasOpened = store.hasOpened
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
    void syncActiveDoc(path)
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
    if (!same && !wasOpened) {
      store.toRevertFailedOpen()
    } else {
      store.toSetLoading(false)
    }
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
  store.toSetRootDir(selected)
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
  /** 用户已选择「保留我的」：忽略冲突直接覆盖 */
  force?: boolean
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

    // 知识库文档由服务端写盘 + 落库（app 是唯一写者）；普通文件仍走前端写。
    // 带 expectedHash 是为了发现「打开之后库内又被 agent 发布/回灌改过」的冲突。
    const outcome = await writeDoc({
      path,
      content,
      expectedHash: options?.force ? null : (store.activeDoc?.hash ?? null),
      force: options?.force ?? false
    })
    if (outcome.conflict) {
      store.toSetSaveConflict(true)
      return false
    }
    if (outcome.matched) {
      store.toSetActiveDoc({
        matched: true,
        docId: outcome.doc?.id ?? null,
        baseId: outcome.doc?.baseId ?? null,
        relPath: outcome.doc?.relPath ?? null,
        hash: outcome.hash ?? null,
        revision: outcome.revision ?? null
      })
    } else {
      await writeMarkdownFile(path, content)
    }
    store.toSetSaveConflict(false)

    store.toUpdateMarkdown(content)
    store.toMarkSaved(path)
    syncDerived(content)
    store.toPushRecent(path)
    syncWorkspaceRootForFile(path)
    if (wasUntitled) {
      store.toBumpTree()
    }
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
  bootstrapKnowledgeSession,
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
