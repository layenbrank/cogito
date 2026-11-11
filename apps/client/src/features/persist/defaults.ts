import type { PersistShape } from '@/features/persist/types'

const SESSION_CAP = 8
const CODE_TAB_CAP = 16
const RECENT_HIT_CAP = 20
const BROWSER_VISIT_CAP = 50
const TIPTAP_COLOR_CAP = 12
const CODE_ROOT_CAP = 10
const CODE_RECENT_PATH_CAP = 20

const PERSIST_DEFAULTS: PersistShape = {
  settings: {
    general: { autostart: true, language: 'zh-CN' },
    capture: {
      detect: 'element',
      isRetentionEnabled: true,
      retention: {
        screenshot: { days: 7, count: 100, maxBytes: 500 * 1024 * 1024 },
        recording: { days: 30, count: 50, maxBytes: 5 * 1024 * 1024 * 1024 }
      },
      style: { color: '#4080ff', thickness: 2, filled: false, opacity: 1, fontSize: 18 }
    },
    shortcuts: { version: 1, bindings: {} },
    proxy: {
      enabled: false,
      url: '',
      bypassLocal: true,
      acceptInvalidCerts: false
    }
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
      workspaceRoots: [],
      workspaceRoot: null,
      workspaceID: null,
      recentRoots: [],
      recentPaths: [],
      tabPaths: [],
      activePath: null,
      isSidebarOpen: true,
      sidebarView: 'explorer',
      isSurfaceOpen: false,
      surfaceTab: 'terminal',
      editorFontSize: 13,
      editorLineHeightRatio: 1.55,
      editorFontFamily: '',
      isEditorLigaturesEnabled: true,
      editorWordWrap: 'off',
      editorWordWrapColumn: 100,
      isEditorMinimapEnabled: true,
      isEditorStickyScrollEnabled: true,
      editorRenderWhitespace: 'selection',
      isEditorBracketGuidesEnabled: true,
      isEditorSemanticHighlightingEnabled: true,
      editorTabSize: 2,
      isEditorInsertSpaces: true,
      isHiddenVisible: false,
      tsTypesMode: 'lean'
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
    splitterOpen: { isSidebarOpen: true, isAsideOpen: true, isAsideMaximized: false },
    approvalMode: 'ask',
    agentMode: 'agent',
    modeByThread: {},
    approvalByThread: {},
    modelPrefs: {},
    activeProviderID: null,
    activeRootByWorkspace: {},
    corexMcpTools: '1',
    temperature: 0.7,
    extraSystemPrompt: ''
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
    browserVisits: [],
    tiptapRecentColors: [],
    rememberedUsername: null
  },
  clipchamp: {},
  gallery: { placeholder: true },
  vault: { pinHash: null },
  diagnostics: { reportCrashes: true }
}

export {
  BROWSER_VISIT_CAP,
  CODE_RECENT_PATH_CAP,
  CODE_ROOT_CAP,
  CODE_TAB_CAP,
  PERSIST_DEFAULTS,
  RECENT_HIT_CAP,
  SESSION_CAP,
  TIPTAP_COLOR_CAP
}
