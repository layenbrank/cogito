/**
 * 全局键的运行时生效状态。
 *
 * 只有 `scope: 'global'` 的键位有「生效值 ≠ 设置值」这回事（被别的应用占用 → 回滚旧值或走备用组合），
 * 局部键的状态就是键位表本身。所以这里只存全局键，且用 `useSyncExternalStore` 暴露给设置页 ——
 * 沿用 `features/window/appearance.ts` 的既有范式，不为基础设施再开一个 zustand store。
 */

import type { GlobalShortcutRuntime } from '@/keyboard/types'

type GlobalShortcutSnapshot = Record<string, GlobalShortcutRuntime>

const EMPTY: GlobalShortcutSnapshot = {}
let snapshot: GlobalShortcutSnapshot = EMPTY
const listeners = new Set<() => void>()

function readGlobalShortcuts(): GlobalShortcutSnapshot {
  return snapshot
}

function subscribeGlobalShortcuts(listener: () => void): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

function findGlobalShortcutRuntime(id: string): GlobalShortcutRuntime | undefined {
  return snapshot[id]
}

/** 只有 `keyboard/global.ts` 该调用 */
function publishGlobalShortcuts(next: GlobalShortcutSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

export type { GlobalShortcutSnapshot }
export {
  findGlobalShortcutRuntime,
  publishGlobalShortcuts,
  readGlobalShortcuts,
  subscribeGlobalShortcuts
}
