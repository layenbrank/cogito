/**
 * 切换 / 追加工作区根的统一入口。
 *
 * 切根会关掉「不在新根之下」的标签：干净的直接关，有脏文件时先挂起
 * `pendingRootsChange` 让 CloseConfirmDialog 收口，绝不静默丢缓冲区。
 */
import { normalizeRoots, useCodeStore, type CodeTab } from '@/stores/code'
import { closeTabs } from '@/views/code/lib/close-tabs.ts'
import { isPathInsideRoot } from '@/views/code/lib/path.ts'

interface SwitchWorkspaceOptions {
  workspaceID?: string | null
}

function isTabInsideRoots(tab: CodeTab, roots: string[]): boolean {
  return roots.some(function (root) {
    return isPathInsideRoot(root, tab.path)
  })
}

/** 新根集合下需要关闭的标签（file / diff / commits） */
function findOrphanTabIDs(tabs: CodeTab[], roots: string[]): string[] {
  return tabs
    .filter(function (tab) {
      return tab.kind === 'file' || tab.kind === 'diff' || tab.kind === 'commits'
    })
    .filter(function (tab) {
      return !isTabInsideRoots(tab, roots)
    })
    .map(function (tab) {
      return tab.id
    })
}

/** 硬应用：关标签（含 disposeModel）+ 写状态 + 清展开态 */
function applyWorkspaceRoots(roots: string[], workspaceID: string | null): void {
  const store = useCodeStore.getState()
  const targets = findOrphanTabIDs(store.tabs, roots)
  if (targets.length > 0) closeTabs(targets)
  store.toSetWorkspaceRoots(roots, workspaceID)
  store.toCollapseAll()
  store.toRequestReveal(null)
  store.toSetPendingRootsChange(null)
  if (roots[0]) store.toPushRecentRoot(roots[0])
  store.toBumpTree()
}

function switchWorkspace(nextRoots: string[], options: SwitchWorkspaceOptions = {}): 'applied' | 'pending' {
  const roots = normalizeRoots(nextRoots)
  const workspaceID = options.workspaceID ?? null
  const store = useCodeStore.getState()
  const dirtyTabIDs = findOrphanTabIDs(store.tabs, roots).filter(function (id) {
    return Boolean(
      store.tabs.find(function (tab) {
        return tab.id === id
      })?.isDirty
    )
  })
  if (dirtyTabIDs.length > 0) {
    store.toSetPendingRootsChange({ roots, workspaceID, dirtyTabIDs })
    return 'pending'
  }
  applyWorkspaceRoots(roots, workspaceID)
  return 'applied'
}

function confirmPendingRootsChange(): void {
  const change = useCodeStore.getState().pendingRootsChange
  if (!change) return
  useCodeStore.getState().toSetPendingRootsChange(null)
  applyWorkspaceRoots(change.roots, change.workspaceID)
}

function cancelPendingRootsChange(): void {
  useCodeStore.getState().toSetPendingRootsChange(null)
}

/** 追加一个根（去重）；切换语义由 switchWorkspace 决定 */
function addWorkspaceRoot(root: string): 'applied' | 'pending' {
  const store = useCodeStore.getState()
  return switchWorkspace([...store.roots, root], { workspaceID: store.workspaceID })
}

/** 从工作区移除一个根；只剩一个根时忽略 */
function removeWorkspaceRoot(root: string): 'applied' | 'pending' | 'ignored' {
  const store = useCodeStore.getState()
  if (store.roots.length <= 1) return 'ignored'
  const key = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const next = store.roots.filter(function (item) {
    return item.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() !== key
  })
  if (next.length === store.roots.length) return 'ignored'
  return switchWorkspace(next, { workspaceID: store.workspaceID })
}

export {
  applyWorkspaceRoots,
  findOrphanTabIDs,
  switchWorkspace,
  confirmPendingRootsChange,
  cancelPendingRootsChange,
  addWorkspaceRoot,
  removeWorkspaceRoot
}
export type { SwitchWorkspaceOptions }
