/**
 * 知识库壳状态：左栏页签 + 右栏页签。
 *
 * 开合走 knowledge 偏好（`isSidebarOpen` / `isOutlineOpen`），这里只记「当前哪一页」——
 * 保证全屏最多三列：左栏 | 编辑器 | 右栏，不再叠 Surface + 文件树 + 大纲 + AI。
 */
import { create } from 'zustand'

import { useDockStore } from '@/features/agent/dock'
import { useKnowledgeStore } from '@/stores/knowledge'

type RailTab = 'browse' | 'docs' | 'staging' | 'tasks' | 'settings'
type AsideTab = 'outline' | 'assistant'

/** 兼容旧名：库管理四页 + 浏览 */
type SurfaceTab = RailTab

interface SurfaceState {
  tab: RailTab
  asideTab: AsideTab
  toSetTab: (tab: RailTab) => void
  toSetAsideTab: (tab: AsideTab) => void
  /** 打开左栏并切到指定页；不传 tab 只确保打开 */
  toOpen: (tab?: RailTab) => void
  toClose: () => void
  /** 同页再点则关；否则打开并切页 */
  toToggle: (tab?: RailTab) => void
  /** 右栏：同页再点则关；切页并打开 */
  toToggleAside: (tab: AsideTab) => void
  toOpenAside: (tab: AsideTab) => void
  toCloseAside: () => void
}

function openSidebar() {
  if (!useKnowledgeStore.getState().isSidebarOpen) {
    useKnowledgeStore.getState().toToggleSidebar()
  }
}

function closeSidebar() {
  if (useKnowledgeStore.getState().isSidebarOpen) {
    useKnowledgeStore.getState().toToggleSidebar()
  }
}

function writeAsideOpen(isOpen: boolean) {
  useKnowledgeStore.getState().toPatchPreferences({ isOutlineOpen: isOpen })
}

const useSurfaceStore = create<SurfaceState>(function (set, get) {
  return {
    tab: 'browse',
    asideTab: 'outline',

    toSetTab: function (tab) {
      set({ tab })
    },

    toSetAsideTab: function (tab) {
      set({ asideTab: tab })
    },

    toOpen: function (tab) {
      openSidebar()
      if (tab) set({ tab })
    },

    toClose: function () {
      closeSidebar()
    },

    toToggle: function (tab) {
      const isOpen = useKnowledgeStore.getState().isSidebarOpen
      if (isOpen && (!tab || tab === get().tab)) {
        closeSidebar()
        return
      }
      openSidebar()
      if (tab) set({ tab })
    },

    toOpenAside: function (tab) {
      set({ asideTab: tab })
      writeAsideOpen(true)
      if (tab === 'assistant') {
        useDockStore.getState().toOpen()
      }
    },

    toCloseAside: function () {
      writeAsideOpen(false)
      useDockStore.getState().toClose()
    },

    toToggleAside: function (tab) {
      const isOpen = useKnowledgeStore.getState().isOutlineOpen
      if (isOpen && get().asideTab === tab) {
        get().toCloseAside()
        return
      }
      get().toOpenAside(tab)
    }
  }
})

export { useSurfaceStore }
export type { AsideTab, RailTab, SurfaceState, SurfaceTab }
