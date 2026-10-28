/**
 * 知识库左面板的开关与当前页签。
 *
 * 与 dock 一样只存「壳」状态：数据都在 `stores/knowledge-base` 与 `stores/automation` 里。
 */
import { create } from 'zustand'

type PanelTab = 'docs' | 'staging' | 'tasks' | 'settings'

interface PanelState {
  isOpen: boolean
  tab: PanelTab
  toOpen: (tab?: PanelTab) => void
  toClose: () => void
  toToggle: (tab?: PanelTab) => void
  toSetTab: (tab: PanelTab) => void
}

const usePanelStore = create<PanelState>(function (set, get) {
  return {
    isOpen: true,
    tab: 'docs',

    toOpen: function (tab) {
      set({ isOpen: true, tab: tab ?? get().tab })
    },

    toClose: function () {
      set({ isOpen: false })
    },

    toToggle: function (tab) {
      if (get().isOpen && (!tab || tab === get().tab)) {
        set({ isOpen: false })
        return
      }
      set({ isOpen: true, tab: tab ?? get().tab })
    },

    toSetTab: function (tab) {
      set({ tab })
    }
  }
})

export { usePanelStore }
export type { PanelState, PanelTab }
