import { exists } from '@tauri-apps/plugin-fs'
import { toast } from 'sonner'

import { listBases, resolveDoc, writeDoc } from '@/lib/knowledge-ipc'
import { useDictStore } from '@/stores/dict'
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
import { isSamePath } from '@/views/knowledge/lib/path.ts'
import { serializeHtmlToMarkdown } from '@/views/knowledge/lib/serialize-markdown.ts'
import { findDocStats, isLargeMarkdown } from '@/views/knowledge/lib/stats.ts'
import { t } from '@/views/knowledge/locale.ts'

/**
 * 侧栏工作区根：
 * 1. 优先用户「打开文件夹」写入并落盘的 `workspaceRoot`
 * 2. 否则才用当前知识库目录（系统默认库目录名是 `default`，空库时不应抢占侧栏）
 * 3. 打开/保存文件不得改写 rootDir（旧逻辑会缩成文件父目录）
 */
async function ensureRootDir(): Promise<string> {
  const store = useKnowledgeStore.getState()
  if (store.rootDir) return store.rootDir
  if (store.workspaceRoot) {
    store.toSetRootDir(store.workspaceRoot)
    return store.workspaceRoot
  }
  // 没有用户工作区时不把 default 库目录写进侧栏 rootDir，只返回路径给新建/读写
  return findActiveBaseRoot()
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

/** 保存世代：写盘完成后若已有更新的保存在飞，丢弃旧结果的「已保存」标记 */
let saveSequence = 0

/** 自身写盘后短时间内忽略 file watch，避免刚保存又 force 重载冲掉编辑 */
let ignoreWatchUntil = 0

function noteSelfWrite(): void {
  ignoreWatchUntil = Date.now() + 1_500
}

function shouldIgnoreFileWatch(): boolean {
  return Date.now() < ignoreWatchUntil
}

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
    // 字典 cache 与偏好并行灌入；角标/任务态依赖 label
    void useDictStore.getState().bootstrap()
    // hydrate 会把落盘的 workspaceRoot 灌进 rootDir；没有则 rootDir 保持 null
    await store.hydrateFromStore()
    const state = useKnowledgeStore.getState()
    if (!state.hasOpened) {
      for (const path of state.recentPaths) {
        const opened = await openPath(path)
        if (opened) break
      }
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

  // 自身保存触发的 watch：直接跳过，避免把未落盘编辑冲掉
  if (same && options.force && shouldIgnoreFileWatch()) {
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

    // 强制重载时若编辑器又脏了（保存竞态窗口），不要用磁盘覆盖
    if (same && options.force && useKnowledgeStore.getState().isDirty) {
      store.toSetLoading(false)
      store.toSetExternalChanged(true)
      return false
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
  store.toSetRootDir(selected, { persist: true })
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
  /** 内部：追赶保存深度，防止序列化抖动死循环 */
  depth?: number
}): Promise<boolean> {
  const store = useKnowledgeStore.getState()
  const depth = options?.depth ?? 0
  const content = findCurrentMarkdown(options?.liveHtml)
  const sequence = ++saveSequence

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
    // 捕获开始保存时的 hash，避免 await 期间 activeDoc 被换掉用错
    const expectedHash = options?.force ? null : (store.activeDoc?.hash ?? null)

    // 知识库文档由服务端写盘 + 落库（app 是唯一写者）；普通文件仍走前端写。
    noteSelfWrite()
    const outcome = await writeDoc({
      path,
      content,
      expectedHash,
      force: options?.force ?? false
    })
    if (outcome.conflict) {
      useKnowledgeStore.getState().toSetSaveConflict(true)
      return false
    }
    if (outcome.matched) {
      useKnowledgeStore.getState().toSetActiveDoc({
        matched: true,
        docId: outcome.doc?.id ?? null,
        baseId: outcome.doc?.baseId ?? null,
        relPath: outcome.doc?.relPath ?? null,
        hash: outcome.hash ?? null,
        revision: outcome.revision ?? null
      })
    } else {
      noteSelfWrite()
      await writeMarkdownFile(path, content)
    }

    // 已有更新的保存在飞：本轮只负责写盘，不要清 dirty / 回写旧快照
    if (sequence !== saveSequence) return true

    const latest = useKnowledgeStore.getState()
    if (!isSamePath(latest.activePath, path)) return true

    // 写盘期间用户又改了：保留 dirty，切勿用旧 content 覆盖 store / 假装已保存
    const currentContent = findCurrentMarkdown()
    if (currentContent !== content) {
      latest.toSetSaveConflict(false)
      if (depth >= 2) {
        // 仍脏着，留给下一次 autosave / 手动保存；不要死循环
        return true
      }
      return saveDocument({ force: options?.force, depth: depth + 1 })
    }

    latest.toCommitSaved({ path, markdown: content })
    syncDerived(content)
    latest.toPushRecent(path)
    if (wasUntitled) {
      latest.toBumpTree()
    }
    return true
  } catch (error) {
    if (sequence !== saveSequence) return false
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
  syncDerived,
  shouldIgnoreFileWatch,
  noteSelfWrite
}
