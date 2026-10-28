import type { PersistShape } from '@/features/persist/types'

const SESSION_CAP = 8
const CODE_TAB_CAP = 16
const RECENT_HIT_CAP = 20
const TIPTAP_COLOR_CAP = 12

const PERSIST_DEFAULTS: PersistShape = {
  settings: {
    general: { autostart: true, language: 'zh-CN' },
    capture: {
      detect: 'element',
      isRetentionEnabled: true,
      retention: {
        screenshot: { days: 7, count: 100, maxBytes: 500 * 1024 * 1024 },
        recording: { days: 30, count: 50, maxBytes: 5 * 1024 * 1024 * 1024 }
      }
    },
    shortcuts: { version: 1, bindings: {} }
  },
  tiles: {
    sessions: [],
    knowledge: {
      isSidebarOpen: true,
      isOutlineOpen: true,
      viewMode: 'live',
      fontSize: 16,
      contentMaxWidth: 760,
      autosaveMs: 3000,
      isTypographyEnabled: true,
      isFocusMode: false,
      isTypewriter: false,
      recentPaths: [],
      workspaceRoot: null
    },
    code: {
      workspaceRoot: null,
      tabPaths: [],
      activePath: null,
      isSidebarOpen: true,
      sidebarView: 'explorer',
      isPanelOpen: false,
      panelTab: 'terminal',
      editorFontSize: 13,
      editorLineHeightRatio: 1.55,
      editorFontFamily: '',
      isEditorLigaturesEnabled: true,
      isHiddenVisible: false
    },
    signboard: {
      activeBoardID: null,
      viewModeByBoard: {}
    },
    bookmark: {
      viewMode: 'list',
      sortKey: 'type'
    }
  },
  agent: {
    splitterLayout: null,
    splitterOpen: { isSidebarOpen: true, isAsideOpen: true },
    approvalMode: 'ask',
    modelPrefs: {},
    corexMcpTools: '1'
  },
  window: {
    appearance: {
      mode: 'system',
      motion: 'system',
      color: '#4080ff',
      foreground: '#ffffff',
      radius: 10
    },
    clockStyle: 'digital',
    engineKey: 'bing',
    recentHits: [],
    tiptapRecentColors: [],
    rememberedUsername: null
  },
  clipchamp: {},
  gallery: { placeholder: true },
  vault: { pinHash: null }
}

export { PERSIST_DEFAULTS, SESSION_CAP, CODE_TAB_CAP, RECENT_HIT_CAP, TIPTAP_COLOR_CAP }
