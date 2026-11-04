/**
 * 知识库壳状态：主区页签 + 右栏（大纲 | AI | 深度研究）。
 * Research 是右栏 aside tab，不再单独占一列容器。
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
  | 'settings'

/** 旧页签名：读入时映射到 canonical */
type RailTabLegacy =
  | 'browse'
  | 'docs'
  | 'tasks'
  | 'staging'
  | 'research'
  | 'activity'

type RailTab = RailTabCanonical | RailTabLegacy
type AsideTab = 'outline' | 'assistant' | 'research'

/** 兼容旧名 */
type SurfaceTab = RailTab

type PreviewReturnTab = Exclude<RailTabCanonical, 'wiki' | 'settings'> | null

interface SurfaceState {
  tab: RailTabCanonical
  asideTab: AsideTab
  /** 从工具主区打开文档后可回跳的 tab */
  previewReturnTab: PreviewReturnTab
  toSetTab: (tab: RailTab) => void
  toSetAsideTab: (tab: AsideTab) => void
  /** 打开右栏并切到深度研究（settings 下先回 wiki） */
  toSetResearchOpen: (open: boolean) => void
  toToggleResearch: () => void
  /** 打开成功后提交：记 return + 切 wiki */
  toCommitPreviewOpen: (fromTab: RailTabCanonical) => void
  toClearPreviewReturn: () => void
  toReturnFromPreview: () => void
  /** 打开左栏并切到指定页；不传 tab 只确保打开 */
  toOpen: (tab?: RailTab) => void
  toClose: () => void
  /** 同页再点则关；否则打开并切页 */
  toToggle: (tab?: RailTab) => void
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
    case 'staging':
      return 'review'
    case 'tasks':
    case 'research':
    case 'activity':
      return 'wiki'
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

function isResearchAsideActive(): boolean {
  const surface = useSurfaceStore.getState()
  return (
    useKnowledgeStore.getState().isOutlineOpen && surface.asideTab === 'research'
  )
}

const useSurfaceStore = create<SurfaceState>(function (set, get) {
  return {
    tab: 'wiki',
    asideTab: 'outline',
    previewReturnTab: null,

    toSetTab: function (tab) {
      const next = normalizeRailTab(tab)
      set({ tab: next, previewReturnTab: null })
    },

    toSetAsideTab: function (tab) {
      set({ asideTab: tab })
      writeAsideOpen(true)
      if (tab === 'assistant') {
        useDockStore.getState().toOpen()
      } else if (useDockStore.getState().isOpen) {
        useDockStore.getState().toClose()
      }
    },

    toSetResearchOpen: function (open) {
      if (open) {
        if (get().tab === 'settings') {
          set({ tab: 'wiki', previewReturnTab: null, asideTab: 'research' })
        } else {
          set({ asideTab: 'research' })
        }
        useDockStore.getState().toClose()
        writeAsideOpen(true)
        return
      }
      if (get().asideTab === 'research') {
        writeAsideOpen(false)
      }
    },

    toToggleResearch: function () {
      const state = get()
      const asideOpen = useKnowledgeStore.getState().isOutlineOpen
      if (state.tab === 'settings') {
        set({
          tab: 'wiki',
          asideTab: 'research',
          previewReturnTab: null
        })
        useDockStore.getState().toClose()
        writeAsideOpen(true)
        return
      }
      if (asideOpen && state.asideTab === 'research') {
        writeAsideOpen(false)
        return
      }
      set({ asideTab: 'research' })
      useDockStore.getState().toClose()
      writeAsideOpen(true)
    },

    toCommitPreviewOpen: function (fromTab) {
      const returnTab =
        fromTab === 'wiki' || fromTab === 'settings'
          ? get().previewReturnTab
          : (fromTab as Exclude<RailTabCanonical, 'wiki' | 'settings'>)
      set({
        tab: 'wiki',
        previewReturnTab: returnTab
      })
    },

    toClearPreviewReturn: function () {
      set({ previewReturnTab: null })
    },

    toReturnFromPreview: function () {
      const ret = get().previewReturnTab
      if (!ret) return
      set({ tab: ret, previewReturnTab: null })
    },

    toOpen: function (tab) {
      openSidebar()
      if (tab) {
        const next = normalizeRailTab(tab)
        set({ tab: next, previewReturnTab: null })
      }
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
      if (next) set({ tab: next, previewReturnTab: null })
    },

    toOpenAside: function (tab) {
      set({ asideTab: tab })
      writeAsideOpen(true)
      if (tab === 'assistant') {
        useDockStore.getState().toOpen()
      } else {
        useDockStore.getState().toClose()
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

export { isResearchAsideActive, normalizeRailTab, useSurfaceStore }
export type {
  AsideTab,
  PreviewReturnTab,
  RailTab,
  RailTabCanonical,
  RailTabLegacy,
  SurfaceState,
  SurfaceTab
}
