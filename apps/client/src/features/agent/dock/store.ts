/**
 * dock 的打开状态与当前绑定的 scope。
 *
 * 只存「壳」状态（开/关、当前 scope、待执行动作）；对话本身在 assistant-ui 的
 * local runtime 里，靠「折叠不卸载」保住。
 */
import { create } from 'zustand'

import type { DockScope } from './types'

interface DockState {
  scope: DockScope | null
  isOpen: boolean
  /** 待执行的一键动作 id：scope 挂载后由 `DockActionRunner` 消费一次 */
  pendingAction: string | null
  /** 待发送的一句话（面板里填了主题/问题后直接开跑，不经输入框） */
  pendingText: string | null
  /** 换一个值就重建会话（「新对话」） */
  resetKey: number
  toBind: (scope: DockScope) => void
  toUnbind: (key: string) => void
  toOpen: (actionID?: string) => void
  /** 打开并直接发一句话（动作之外的入口，如「按这个主题生成」） */
  toAsk: (text: string) => void
  toClose: () => void
  toToggle: () => void
  toReset: () => void
  toTakePending: () => { actionID: string | null; text: string | null }
}

const useDockStore = create<DockState>(function (set, get) {
  return {
    scope: null,
    isOpen: false,
    pendingAction: null,
    pendingText: null,
    resetKey: 0,

    toBind: function (scope) {
      if (get().scope?.key === scope.key) {
        // 同一磁贴重渲染：只刷新闭包（上下文是实时读的），不重置对话
        set({ scope })
        return
      }
      set({ scope, pendingAction: null, pendingText: null })
    },

    toUnbind: function (key) {
      if (get().scope?.key !== key) return
      set({ scope: null, isOpen: false, pendingAction: null, pendingText: null })
    },

    toOpen: function (actionID) {
      set({ isOpen: true, pendingAction: actionID ?? null, pendingText: null })
    },

    toAsk: function (text) {
      const value = text.trim()
      if (!value) return
      set({ isOpen: true, pendingAction: null, pendingText: value })
    },

    toClose: function () {
      set({ isOpen: false })
    },

    toToggle: function () {
      set({ isOpen: !get().isOpen })
    },

    toReset: function () {
      set({ resetKey: get().resetKey + 1, pendingAction: null, pendingText: null })
    },

    toTakePending: function () {
      const { pendingAction, pendingText } = get()
      if (!pendingAction && !pendingText) return { actionID: null, text: null }
      set({ pendingAction: null, pendingText: null })
      return { actionID: pendingAction, text: pendingText }
    }
  }
})

export { useDockStore }
export type { DockState }
