import type { PersistNamespace } from '@/features/persist/files'

type CodeSidebarView = 'explorer' | 'search' | 'scm'
type CodePanelTab = 'terminal' | 'problems'
type KnowledgeViewMode = 'live' | 'source' | 'split'
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

interface KnowledgeChrome {
  isSidebarOpen: boolean
  isOutlineOpen: boolean
  viewMode: KnowledgeViewMode
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
  /** 编辑器字号（px） */
  editorFontSize: number
  /** 行高倍数，实际行高 = 字号 × 倍数 */
  editorLineHeightRatio: number
  /** 等宽字体族；空串表示用内置的等宽栈 */
  editorFontFamily: string
  isEditorLigaturesEnabled: boolean
  /** 资源管理器是否显示 `.` 开头的隐藏条目 */
  isHiddenVisible: boolean
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
  knowledge: KnowledgeChrome
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
  detect: 'off' | 'window' | 'element'
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
  KnowledgeChrome,
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
  KnowledgeViewMode,
  SignboardViewMode,
  BookmarkViewMode,
  BookmarkSortKey,
  ClockStyle,
  ApprovalMode,
  ThinkingLevel
}
