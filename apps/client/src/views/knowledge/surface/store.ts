/**
 * 知识库左侧面板（surface）的开关与当前页签。
 *
 * 与 dock 一样只存「壳」状态：数据都在 `stores/knowledge-base` 与 `stores/automation` 里。
 */
import { create } from 'zustand'

type SurfaceTab = 'docs' | 'staging' | 'tasks' | 'settings'

interface SurfaceState {
  isOpen: boolean
  tab: SurfaceTab
  toOpen: (tab?: SurfaceTab) => void
  toClose: () => void
  toToggle: (tab?: SurfaceTab) => void
  toSetTab: (tab: SurfaceTab) => void
}

const useSurfaceStore = create<SurfaceState>(function (set, get) {
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

export { useSurfaceStore }
export type { SurfaceState, SurfaceTab }
