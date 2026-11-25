/**
 * 打开「当前空间」里的文档。
 *
 * 之前这段逻辑散在 `useDocsTab.openDoc` 里；wikilink 跳转、命令面板都要用同一套
 * （切空间根 + 侧栏高亮 + 编辑器打开），抽成无 hook 版本，避免三份拷贝。
 */
import { useKnowledgeStore } from '@/stores/knowledge'
import { useSpacesStore } from '@/stores/spaces'
import { findFileName, isPathInsideRoot, isSamePath, joinPath } from '@/views/knowledge/lib/path.ts'
import { openEditorPath } from '@/views/knowledge/workspace/editor-context.ts'

interface SpaceDocRef {
  rootPath: string
  relPath: string
}

function findActiveSpace() {
  const state = useSpacesStore.getState()
  return state.spaces.find(function (space) {
    return space.id === state.activeSpaceID
  }) ?? null
}

function normalizeTitle(title: string): string {
  return title.trim().replace(/\.md$/i, '').replace(/\s+/g, ' ').toLowerCase()
}

/**
 * 按标题找当前空间里的文档。
 *
 * `[[页面#小节]]` 的锚点部分先剥掉——本仓库的页面即文件，暂不支持段落锚点。
 */
function findSpaceDocByTitle(rawTitle: string): SpaceDocRef | null {
  const space = findActiveSpace()
  if (!space) return null
  const target = normalizeTitle(rawTitle.split('#')[0] ?? '')
  if (!target) return null
  const docs = useSpacesStore.getState().docs
  const hit =
    docs.find(function (doc) {
      return normalizeTitle(doc.title) === target
    }) ??
    docs.find(function (doc) {
      return normalizeTitle(findFileName(doc.relPath)) === target
    })
  if (!hit) return null
  return { rootPath: space.rootPath, relPath: hit.relPath }
}

/** 打开当前空间内的相对路径；没有活动空间时返回 false */
function openSpaceDoc(relativePath: string): boolean {
  const space = findActiveSpace()
  if (!space) return false
  const absolute = joinPath(space.rootPath, relativePath)
  const workspace = useKnowledgeStore.getState()
  const isInsideWorkspace =
    Boolean(workspace.rootDir) && isPathInsideRoot(workspace.rootDir!, absolute)
  if (!isInsideWorkspace && !isSamePath(workspace.rootDir, space.rootPath)) {
    workspace.toSetRootDir(space.rootPath, { persist: true })
    workspace.toBumpTree()
  }
  openEditorPath(absolute)
  return true
}

export { findSpaceDocByTitle, openSpaceDoc }
export type { SpaceDocRef }
