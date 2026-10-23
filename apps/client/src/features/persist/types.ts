import type { PersistNamespace } from '@/features/persist/files'

type CodeSidebarView = 'explorer' | 'search' | 'scm'
type CodePanelTab = 'terminal' | 'problems'
type MarkdownViewMode = 'live' | 'source' | 'split'
type SignboardViewMode = 'board' | 'table' | 'gantt' | 'calendar' | 'stats' | 'workload'
type BookmarkViewMode = 'list' | 'grid'
type BookmarkSortKey = 'name-asc' | 'name-desc' | 'type' | 'links' | 'index'
type ClockStyle = 'digital' | 'analog' | 'flip' | 'neon' | 'minimal'
type ApprovalMode = 'ask' | 'auto' | 'readonly'
type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max'
type AppearanceMode = 'system' | 'light' | 'dark'
type MotionPreference = 'system' | 'on' | 'off'

interface TileSessionPref {
  component: MagneticTile.Component
  tileId: string
  url: string
  path: string
}

interface MarkdownChrome {
  rootDir: string | null
  isSidebarOpen: boolean
  isOutlineOpen: boolean
  viewMode: MarkdownViewMode
  fontSize: number
  contentMaxWidth: number
  autosaveMs: number
  isTypographyEnabled: boolean
  isFocusMode: boolean
  isTypewriter: boolean
  recentPaths: string[]
}

interface CodeChrome {
  workspaceRoot: string | null
  tabPaths: string[]
  activePath: string | null
  isSidebarOpen: boolean
  sidebarView: CodeSidebarView
  isPanelOpen: boolean
  panelTab: CodePanelTab
}

interface SignboardChrome {
  activeBoardID: string | null
  viewModeByBoard: Record<string, SignboardViewMode>
}

interface BookmarkChrome {
  viewMode: BookmarkViewMode
  sortKey: BookmarkSortKey
}

interface TilesPref {
  sessions: TileSessionPref[]
  markdown: MarkdownChrome
  code: CodeChrome
  signboard: SignboardChrome
  bookmark: BookmarkChrome
}

interface ModelPref {
  visible: boolean
  thinking: ThinkingLevel
  contextWindow: number
}

interface AgentSplitterOpen {
  isSidebarOpen: boolean
  isAsideOpen: boolean
}

interface AgentPref {
  splitterLayout: Record<string, number> | null
  splitterOpen: AgentSplitterOpen
  approvalMode: ApprovalMode
  modelPrefs: Record<string, ModelPref>
  /** `1` 开 / `0` 关；与历史 localStorage 语义对齐 */
  corexMcpTools: '0' | '1'
}

interface WindowAppearance {
  mode: AppearanceMode
  motion: MotionPreference
  color: string
  foreground: string
  radius: number
}

interface CommandBarRecentHit {
  domain: string
  id: string
  title: string
  subtitle?: string
  icon?: string
}

interface WindowPref {
  appearance: WindowAppearance
  clockStyle: ClockStyle
  engineKey: string
  recentHits: CommandBarRecentHit[]
  tiptapRecentColors: string[]
  rememberedUsername: string | null
}

interface GalleryPref {
  /** 预留图库域偏好；PIN 不在此文件 */
  placeholder: true
}

interface VaultPref {
  pinHash: string | null
}

/** clipchamp 工程为自由形状 blob */
type ClipchampPref = Record<string, unknown>

interface SettingsGeneral {
  autostart: boolean
  language: string
}

interface SettingsCaptureRetention {
  days: number
  count: number
  maxBytes: number
}

interface SettingsCapture {
  detect: 'off' | 'window'
  isRetentionEnabled: boolean
  retention: {
    screenshot: SettingsCaptureRetention
    recording: SettingsCaptureRetention
  }
}

interface SettingsShortcuts {
  version: number
  bindings: Record<string, string>
}

interface SettingsPref {
  general: SettingsGeneral
  capture: SettingsCapture
  shortcuts: SettingsShortcuts
}

interface PersistShape {
  settings: SettingsPref
  tiles: TilesPref
  agent: AgentPref
  window: WindowPref
  clipchamp: ClipchampPref
  gallery: GalleryPref
  vault: VaultPref
}

type PersistValue<N extends PersistNamespace> = PersistShape[N]

export type {
  PersistShape,
  PersistValue,
  TileSessionPref,
  MarkdownChrome,
  CodeChrome,
  SignboardChrome,
  BookmarkChrome,
  TilesPref,
  AgentPref,
  AgentSplitterOpen,
  ModelPref,
  WindowPref,
  WindowAppearance,
  CommandBarRecentHit,
  GalleryPref,
  VaultPref,
  ClipchampPref,
  SettingsPref,
  CodeSidebarView,
  CodePanelTab,
  MarkdownViewMode,
  SignboardViewMode,
  BookmarkViewMode,
  BookmarkSortKey,
  ClockStyle,
  ApprovalMode,
  ThinkingLevel
}
