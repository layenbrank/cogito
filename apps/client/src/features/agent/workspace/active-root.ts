/**
 * 「当前文件夹」单一真源。
 *
 * 一个工作区可以挂多个目录（frontend / backend / docs…）。审阅、文件、提交历史、
 * composer 的分支区都在看同一个文件夹，否则左边切了分支右边还在看旧目录。
 *
 * 内存里记 `workspaceID → path`，同时落到 `agent.activeRootByWorkspace`，
 * 重启后还停在用户上次选的文件夹。选中的 path 若已从工作区移除，由
 * `useActiveWorkspace` 回落第一个文件夹。
 */
import { useSyncExternalStore } from 'react'

import { findPref, patchPref } from '@/features/persist/store'

const listeners = new Set<() => void>()
const selectedByWorkspace = new Map<string, string>()

let version = 0
let isHydrated = false

function hydrateOnce() {
  if (isHydrated) return
  isHydrated = true
  const stored = findPref('agent').activeRootByWorkspace
  for (const [workspaceID, path] of Object.entries(stored ?? {})) {
    if (workspaceID && typeof path === 'string' && path) {
      selectedByWorkspace.set(workspaceID, path)
    }
  }
}

function readVersion(): number {
  return version
}

function subscribeActiveRoot(listener: () => void): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

function notify() {
  version += 1
  for (const listener of [...listeners]) listener()
}

async function persist() {
  const snapshot: Record<string, string> = {}
  for (const [workspaceID, path] of selectedByWorkspace) snapshot[workspaceID] = path
  try {
    await patchPref('agent', { activeRootByWorkspace: snapshot })
  } catch (cause) {
    console.warn('[agent/active-root] 保存当前文件夹失败:', cause)
  }
}

/** 读用户选过的文件夹（未与工作区实际列表校验，校验在 useActiveWorkspace 里） */
function readActiveRootPath(workspaceID: string | null): string | null {
  if (!workspaceID) return null
  hydrateOnce()
  return selectedByWorkspace.get(workspaceID) ?? null
}

/** 切换当前文件夹；传 null 表示放弃选择、回落主文件夹 */
function selectActiveRootPath(workspaceID: string, path: string | null) {
  if (!workspaceID) return
  hydrateOnce()
  const prev = selectedByWorkspace.get(workspaceID) ?? null
  if (prev === path) return
  if (path) selectedByWorkspace.set(workspaceID, path)
  else selectedByWorkspace.delete(workspaceID)
  notify()
  void persist()
}

/** 面板侧订阅：任何工作区的切换都会触发重渲 */
function useActiveRootVersion(): number {
  return useSyncExternalStore(subscribeActiveRoot, readVersion, readVersion)
}

export { readActiveRootPath, selectActiveRootPath, subscribeActiveRoot, useActiveRootVersion }
