/**
 * 知识库壳状态：左栏页签 + 右栏页签。
 *
 * 开合走 knowledge 偏好（`isSidebarOpen` / `isOutlineOpen`），这里只记「当前哪一页」——
 * 保证全屏最多三列：左栏 | 编辑器 | 右栏，不再叠 Surface + 文件树 + 大纲 + AI。
 */
import { create } from 'zustand'

import { useDockStore } from '@/features/agent/dock'
import { useKnowledgeStore } from '@/stores/knowledge'

type RailTabCanonical =
  | 'wiki'
  | 'sources'
  | 'search'
  | 'graph'
  | 'lint'
  | 'review'
  | 'research'
  | 'activity'
  | 'settings'

/** 旧页签名：读入时映射到 canonical（browse→sources，docs→wiki，staging→review） */
type RailTabLegacy = 'browse' | 'docs' | 'tasks' | 'staging'

type RailTab = RailTabCanonical | RailTabLegacy
type AsideTab = 'outline' | 'assistant'

/** 兼容旧名 */
type SurfaceTab = RailTab

interface SurfaceState {
  tab: RailTabCanonical
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

function normalizeRailTab(tab: RailTab): RailTabCanonical {
  switch (tab) {
    case 'browse':
      return 'sources'
    case 'docs':
      return 'wiki'
    case 'tasks':
      return 'research'
    case 'staging':
      return 'review'
    default:
      return tab
  }
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
    tab: 'wiki',
    asideTab: 'outline',

    toSetTab: function (tab) {
      set({ tab: normalizeRailTab(tab) })
    },

    toSetAsideTab: function (tab) {
      set({ asideTab: tab })
    },

    toOpen: function (tab) {
      openSidebar()
      if (tab) set({ tab: normalizeRailTab(tab) })
    },

    toClose: function () {
      closeSidebar()
    },

    toToggle: function (tab) {
      const isOpen = useKnowledgeStore.getState().isSidebarOpen
      const next = tab ? normalizeRailTab(tab) : undefined
      if (isOpen && (!next || next === get().tab)) {
        closeSidebar()
        return
      }
      openSidebar()
      if (next) set({ tab: next })
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

export { normalizeRailTab, useSurfaceStore }
export type { AsideTab, RailTab, RailTabCanonical, RailTabLegacy, SurfaceState, SurfaceTab }
