/**
 * composer 的撤销 / 重做栈（纯逻辑，不碰 DOM）。
 *
 * 为什么要自己维护：`composer-input.aui.tsx` 每次改动都 `replaceChildren()` 重建 DOM，
 * 浏览器原生撤销栈记的是被摘掉的旧节点 —— chip 插入 / 删除 / 粘贴之后 `Ctrl+Z`
 * 会让文本与 DOM 失配。这里以 `ComposerAtom[]` 快照为撤销单元，chip 与文本一视同仁。
 *
 * 两条规则：
 * - **连续输入合并**：`typing` 且距上次入栈 < `mergeMs` 时不再入栈（一次撤销回退一串敲键）；
 * - **离散操作独立成步**：chip 删除、粘贴、触发器选中一律入栈，并把合并窗口重置 ——
 *   否则「插 chip 后立刻删掉」会被并成一步，撤销直接跳回插入之前。
 *
 * 外部变化（发送清空 / 切会话 / 编辑回填）由调用方 `clear()`：撤销不能复活已发送的内容。
 */
import type { ComposerAtom } from './composer-document'

type ComposerHistoryEntry = {
  atoms: ComposerAtom[]
  cursor: number
}

type ComposerHistoryKind = 'typing' | 'discrete'

type ComposerHistoryOptions = {
  /** 栈上限（步） */
  limit?: number
  /** 连续输入的合并窗口（毫秒） */
  mergeMs?: number
}

type ComposerHistory = {
  /** 记录一次「操作之前」的快照 */
  remember: (kind: ComposerHistoryKind, snapshot: ComposerHistoryEntry, now?: number) => void
  /** 弹出上一步；`current` 会被压进重做栈 */
  undo: (current: ComposerHistoryEntry) => ComposerHistoryEntry | null
  /** 重做一步；`current` 会被压回撤销栈 */
  redo: (current: ComposerHistoryEntry) => ComposerHistoryEntry | null
  /** 外部变化时清空（撤销不该跨回合 / 跨会话） */
  clear: () => void
  /** 便于单测与调试 */
  size: () => { undo: number; redo: number }
}

const DEFAULT_LIMIT = 100
const DEFAULT_MERGE_MS = 500

function createComposerHistory(options?: ComposerHistoryOptions): ComposerHistory {
  const limit = options?.limit ?? DEFAULT_LIMIT
  const mergeMs = options?.mergeMs ?? DEFAULT_MERGE_MS
  let undoStack: ComposerHistoryEntry[] = []
  let redoStack: ComposerHistoryEntry[] = []
  let lastKind: ComposerHistoryKind | null = null
  let lastAt = 0

  return {
    remember(kind, snapshot, now = Date.now()) {
      const merged = kind === 'typing' && lastKind === 'typing' && now - lastAt < mergeMs
      if (!merged) {
        undoStack.push(snapshot)
        if (undoStack.length > limit) undoStack.shift()
      }
      // 任何新操作都让「重做」失效（与编辑器常规语义一致）
      redoStack = []
      lastKind = kind
      lastAt = now
    },
    undo(current) {
      const entry = undoStack.pop()
      if (!entry) return null
      redoStack.push(current)
      lastKind = null
      lastAt = 0
      return entry
    },
    redo(current) {
      const entry = redoStack.pop()
      if (!entry) return null
      undoStack.push(current)
      lastKind = null
      lastAt = 0
      return entry
    },
    clear() {
      undoStack = []
      redoStack = []
      lastKind = null
      lastAt = 0
    },
    size() {
      return { undo: undoStack.length, redo: redoStack.length }
    }
  }
}

export { DEFAULT_LIMIT, DEFAULT_MERGE_MS, createComposerHistory }
export type { ComposerHistory, ComposerHistoryEntry, ComposerHistoryKind, ComposerHistoryOptions }
