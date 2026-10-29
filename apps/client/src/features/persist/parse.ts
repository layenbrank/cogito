import {
  CODE_TAB_CAP,
  PERSIST_DEFAULTS,
  RECENT_HIT_CAP,
  SESSION_CAP,
  TIPTAP_COLOR_CAP
} from '@/features/persist/defaults'
import type { PersistNamespace } from '@/features/persist/files'
import type {
  AgentPref,
  ClipchampPref,
  GalleryPref,
  PersistShape,
  PersistValue,
  SettingsPref,
  TilesPref,
  VaultPref,
  WindowPref,
  TileSessionPref,
  SignboardViewMode,
  ModelPref
} from '@/features/persist/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 数字段：非数字/NaN 回退默认值，超界按区间收敛 */
function parseNumber(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

function parseBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback
}

function parseSessions(raw: unknown): TileSessionPref[] {
  if (!Array.isArray(raw)) return []
  const sessions: TileSessionPref[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    if (typeof item.component !== 'string') continue
    if (typeof item.path !== 'string' || !item.path) continue
    sessions.push({
      component: item.component as MagneticTile.Component,
      tileId: typeof item.tileId === 'string' ? item.tileId : item.component,
      url: typeof item.url === 'string' ? item.url : '',
      path: item.path
    })
    if (sessions.length >= SESSION_CAP) break
  }
  return sessions
}

const SIGNBOARD_VIEWS: SignboardViewMode[] = [
  'board',
  'table',
  'gantt',
  'calendar',
  'stats',
  'workload'
]

function parseSignboardViewMode(raw: unknown): SignboardViewMode | null {
  if (typeof raw !== 'string') return null
  return SIGNBOARD_VIEWS.includes(raw as SignboardViewMode)
    ? (raw as SignboardViewMode)
    : null
}

function parseTiles(raw: unknown): TilesPref {
  const base = PERSIST_DEFAULTS.tiles
  if (!isRecord(raw)) return structuredClone(base)
  const knowledge = isRecord(raw.knowledge) ? raw.knowledge : {}
  const code = isRecord(raw.code) ? raw.code : {}
  const signboard = isRecord(raw.signboard) ? raw.signboard : {}
  const bookmark = isRecord(raw.bookmark) ? raw.bookmark : {}

  const viewModeByBoard: Record<string, SignboardViewMode> = {}
  if (isRecord(signboard.viewModeByBoard)) {
    for (const [boardID, mode] of Object.entries(signboard.viewModeByBoard)) {
      const parsed = parseSignboardViewMode(mode)
      if (parsed) viewModeByBoard[boardID] = parsed
    }
  }

  const sidebarView =
    code.sidebarView === 'search' || code.sidebarView === 'scm' || code.sidebarView === 'explorer'
      ? code.sidebarView
      : base.code.sidebarView
  // 兼容旧键 panelTab / isPanelOpen（tiles.json 历史字段）；写出时不再保留旧键
  const legacyPanelTab = code.panelTab
  const legacyIsPanelOpen = code.isPanelOpen
  const {
    panelTab: _legacyPanelTab,
    isPanelOpen: _legacyIsPanelOpen,
    ...codeFields
  } = code as typeof code & {
    panelTab?: unknown
    isPanelOpen?: unknown
  }
  const rawSurfaceTab = code.surfaceTab ?? legacyPanelTab
  // 旧版 gitSearch 已迁到编辑器独立标签，落盘底栏只保留 terminal / problems
  const surfaceTab =
    rawSurfaceTab === 'problems' || rawSurfaceTab === 'terminal'
      ? rawSurfaceTab
      : base.code.surfaceTab
  const isSurfaceOpen =
    typeof code.isSurfaceOpen === 'boolean'
      ? code.isSurfaceOpen
      : typeof legacyIsPanelOpen === 'boolean'
        ? legacyIsPanelOpen
        : base.code.isSurfaceOpen
  const mdView =
    knowledge.viewMode === 'source' || knowledge.viewMode === 'split' || knowledge.viewMode === 'live'
      ? knowledge.viewMode
      : base.knowledge.viewMode
  const bookmarkView =
    bookmark.viewMode === 'grid' || bookmark.viewMode === 'list'
      ? bookmark.viewMode
      : base.bookmark.viewMode
  const sortKey =
    bookmark.sortKey === 'name-asc' ||
    bookmark.sortKey === 'name-desc' ||
    bookmark.sortKey === 'type' ||
    bookmark.sortKey === 'links' ||
    bookmark.sortKey === 'index'
      ? bookmark.sortKey
      : base.bookmark.sortKey

  return {
    sessions: parseSessions(raw.sessions),
    knowledge: {
      ...base.knowledge,
      ...knowledge,
      viewMode: mdView,
      recentPaths: Array.isArray(knowledge.recentPaths)
        ? knowledge.recentPaths.filter(function (item) {
            return typeof item === 'string'
          }).slice(0, 20)
        : [],
      workspaceRoot:
        typeof knowledge.workspaceRoot === 'string' && knowledge.workspaceRoot.trim()
          ? knowledge.workspaceRoot
          : null
    },
    code: {
      ...base.code,
      ...codeFields,
      sidebarView,
      surfaceTab,
      isSurfaceOpen,
      tabPaths: Array.isArray(code.tabPaths)
        ? code.tabPaths
            .filter(function (item) {
              return typeof item === 'string'
            })
            .slice(0, CODE_TAB_CAP)
        : [],
      workspaceRoot: typeof code.workspaceRoot === 'string' ? code.workspaceRoot : null,
      activePath: typeof code.activePath === 'string' ? code.activePath : null,
      editorFontSize: parseNumber(code.editorFontSize, base.code.editorFontSize, 10, 24),
      editorLineHeightRatio: parseNumber(
        code.editorLineHeightRatio,
        base.code.editorLineHeightRatio,
        1.2,
        2.2
      ),
      editorFontFamily:
        typeof code.editorFontFamily === 'string'
          ? code.editorFontFamily
          : base.code.editorFontFamily,
      isEditorLigaturesEnabled: parseBoolean(
        code.isEditorLigaturesEnabled,
        base.code.isEditorLigaturesEnabled
      ),
      isHiddenVisible: parseBoolean(code.isHiddenVisible, base.code.isHiddenVisible)
    },
    signboard: {
      activeBoardID: typeof signboard.activeBoardID === 'string' ? signboard.activeBoardID : null,
      viewModeByBoard
    },
    bookmark: {
      viewMode: bookmarkView,
      sortKey
    }
  }
}

function parseModelPrefs(raw: unknown): Record<string, ModelPref> {
  if (!isRecord(raw)) return {}
  const next: Record<string, ModelPref> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue
    next[key] = {
      visible: typeof value.visible === 'boolean' ? value.visible : true,
      thinking:
        value.thinking === 'off' ||
        value.thinking === 'low' ||
        value.thinking === 'medium' ||
        value.thinking === 'high' ||
        value.thinking === 'max'
          ? value.thinking
          : 'medium',
      contextWindow:
        typeof value.contextWindow === 'number' && Number.isFinite(value.contextWindow)
          ? value.contextWindow
          : 128_000
    }
  }
  return next
}

function parseAgent(raw: unknown): AgentPref {
  const base = PERSIST_DEFAULTS.agent
  if (!isRecord(raw)) return structuredClone(base)
  const open = isRecord(raw.splitterOpen) ? raw.splitterOpen : {}
  const layout =
    isRecord(raw.splitterLayout) && Object.keys(raw.splitterLayout).length > 0
      ? (raw.splitterLayout as Record<string, number>)
      : null
  return {
    splitterLayout: layout,
    splitterOpen: {
      isSidebarOpen:
        typeof open.isSidebarOpen === 'boolean' ? open.isSidebarOpen : base.splitterOpen.isSidebarOpen,
      isAsideOpen:
        typeof open.isAsideOpen === 'boolean' ? open.isAsideOpen : base.splitterOpen.isAsideOpen
    },
    approvalMode:
      raw.approvalMode === 'ask' || raw.approvalMode === 'auto' || raw.approvalMode === 'readonly'
        ? raw.approvalMode
        : base.approvalMode,
    modelPrefs: parseModelPrefs(raw.modelPrefs),
    corexMcpTools: raw.corexMcpTools === '0' || raw.corexMcpTools === '1' ? raw.corexMcpTools : '1'
  }
}

function parseWindow(raw: unknown): WindowPref {
  const base = PERSIST_DEFAULTS.window
  if (!isRecord(raw)) return structuredClone(base)
  const appearance = isRecord(raw.appearance) ? raw.appearance : {}
  const recentHits = Array.isArray(raw.recentHits)
    ? raw.recentHits
        .filter(isRecord)
        .map(function (item) {
          return {
            domain: typeof item.domain === 'string' ? item.domain : '',
            id: typeof item.id === 'string' ? item.id : '',
            title: typeof item.title === 'string' ? item.title : '',
            subtitle: typeof item.subtitle === 'string' ? item.subtitle : undefined,
            icon: typeof item.icon === 'string' ? item.icon : undefined
          }
        })
        .filter(function (item) {
          return item.domain && item.id && item.title
        })
        .slice(0, RECENT_HIT_CAP)
    : []
  const clockStyle =
    raw.clockStyle === 'digital' ||
    raw.clockStyle === 'analog' ||
    raw.clockStyle === 'flip' ||
    raw.clockStyle === 'neon' ||
    raw.clockStyle === 'minimal'
      ? raw.clockStyle
      : base.clockStyle
  return {
    appearance: {
      mode:
        appearance.mode === 'system' || appearance.mode === 'light' || appearance.mode === 'dark'
          ? appearance.mode
          : base.appearance.mode,
      motion:
        appearance.motion === 'system' || appearance.motion === 'on' || appearance.motion === 'off'
          ? appearance.motion
          : base.appearance.motion,
      color: typeof appearance.color === 'string' ? appearance.color : base.appearance.color,
      foreground:
        typeof appearance.foreground === 'string'
          ? appearance.foreground
          : base.appearance.foreground,
      radius: typeof appearance.radius === 'number' ? appearance.radius : base.appearance.radius
    },
    clockStyle,
    engineKey: typeof raw.engineKey === 'string' ? raw.engineKey : base.engineKey,
    recentHits,
    tiptapRecentColors: Array.isArray(raw.tiptapRecentColors)
      ? raw.tiptapRecentColors
          .filter(function (item) {
            return typeof item === 'string'
          })
          .slice(0, TIPTAP_COLOR_CAP)
      : [],
    rememberedUsername:
      typeof raw.rememberedUsername === 'string' ? raw.rememberedUsername : null
  }
}

function parseGallery(raw: unknown): GalleryPref {
  return { placeholder: true, ...(isRecord(raw) ? {} : {}) }
}

function parseVault(raw: unknown): VaultPref {
  if (!isRecord(raw)) return { pinHash: null }
  return { pinHash: typeof raw.pinHash === 'string' ? raw.pinHash : null }
}

function parseClipchamp(raw: unknown): ClipchampPref {
  return isRecord(raw) ? { ...raw } : {}
}

function parseSettings(raw: unknown): SettingsPref {
  const base = PERSIST_DEFAULTS.settings
  if (!isRecord(raw)) return structuredClone(base)
  const general = isRecord(raw.general) ? raw.general : {}
  const capture = isRecord(raw.capture) ? raw.capture : {}
  const shortcuts = isRecord(raw.shortcuts) ? raw.shortcuts : {}
  const retention = isRecord(capture.retention) ? capture.retention : {}
  const screenshot = isRecord(retention.screenshot) ? retention.screenshot : {}
  const recording = isRecord(retention.recording) ? retention.recording : {}
  const bindings: Record<string, string> = {}
  if (isRecord(shortcuts.bindings)) {
    for (const [id, binding] of Object.entries(shortcuts.bindings)) {
      if (typeof binding === 'string' && binding.trim()) bindings[id] = binding
    }
  }
  return {
    general: {
      autostart: typeof general.autostart === 'boolean' ? general.autostart : base.general.autostart,
      language: typeof general.language === 'string' ? general.language : base.general.language
    },
    capture: {
      detect:
        capture.detect === 'off' || capture.detect === 'window' || capture.detect === 'element'
          ? capture.detect
          : base.capture.detect,
      isRetentionEnabled:
        typeof capture.isRetentionEnabled === 'boolean'
          ? capture.isRetentionEnabled
          : base.capture.isRetentionEnabled,
      retention: {
        screenshot: {
          days: typeof screenshot.days === 'number' ? screenshot.days : base.capture.retention.screenshot.days,
          count:
            typeof screenshot.count === 'number' ? screenshot.count : base.capture.retention.screenshot.count,
          maxBytes:
            typeof screenshot.maxBytes === 'number'
              ? screenshot.maxBytes
              : base.capture.retention.screenshot.maxBytes
        },
        recording: {
          days: typeof recording.days === 'number' ? recording.days : base.capture.retention.recording.days,
          count:
            typeof recording.count === 'number' ? recording.count : base.capture.retention.recording.count,
          maxBytes:
            typeof recording.maxBytes === 'number'
              ? recording.maxBytes
              : base.capture.retention.recording.maxBytes
        }
      }
    },
    shortcuts: {
      version: typeof shortcuts.version === 'number' ? shortcuts.version : 1,
      bindings
    }
  }
}

const PARSE: {
  [N in PersistNamespace]: (raw: unknown) => PersistValue<N>
} = {
  settings: parseSettings,
  tiles: parseTiles,
  agent: parseAgent,
  window: parseWindow,
  clipchamp: parseClipchamp,
  gallery: parseGallery,
  vault: parseVault
}

function parseNamespace<N extends PersistNamespace>(ns: N, raw: unknown): PersistValue<N> {
  return PARSE[ns](raw)
}

function cloneDefaults(): PersistShape {
  return structuredClone(PERSIST_DEFAULTS)
}

export { PARSE, parseNamespace, cloneDefaults, parseSignboardViewMode }
