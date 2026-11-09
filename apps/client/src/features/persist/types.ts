import type { PersistNamespace } from '@/features/persist/files'

type CodeSidebarView = 'explorer' | 'search' | 'scm'
type CodeSurfaceTab = 'terminal' | 'problems'
type CodeWordWrap = 'off' | 'on' | 'bounded'
type CodeRenderWhitespace = 'none' | 'selection' | 'all'
type KnowledgeViewMode = 'live' | 'source' | 'split'
type SignboardViewMode = 'board' | 'table' | 'gantt' | 'calendar' | 'stats' | 'workload'
type BookmarkViewMode = 'list' | 'grid'
type BookmarkSortKey = 'name-asc' | 'name-desc' | 'type' | 'links' | 'index'
type ClockStyle = 'digital' | 'analog' | 'flip'
type ApprovalMode = 'ask' | 'auto' | 'readonly'
/** 会话模式：执行 / 计划 / 问答 / 目标（对齐 Copilot Plan、Qoder 目标模式） */
type AgentMode = 'agent' | 'plan' | 'ask' | 'goal'
type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max'
type AppearanceMode = 'system' | 'light' | 'dark'
type MotionPreference = 'system' | 'on' | 'off'

interface TileSessionPref {
  component: MagneticTile.Component
  tileId: string
  url: string
  path: string
}

interface KnowledgeShell {
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
  /** 用户打开的侧栏工作区根；刷新后恢复，避免落回空的 default 库目录 */
  workspaceRoot: string | null
}

interface CodeShell {
  /** 多根工作区：顺序即 Explorer 顺序，[0] 为主根 */
  workspaceRoots: string[]
  /** 来源 Cogito 工作区；手选文件夹时为 null */
  workspaceID: string | null
  /** 最近打开的文件夹：去重、上限 10 */
  recentRoots: string[]
  /** Ctrl+P 的最近文件：绝对路径、上限 20 */
  recentPaths: string[]
  workspaceRoot: string | null
  tabPaths: string[]
  activePath: string | null
  isSidebarOpen: boolean
  sidebarView: CodeSidebarView
  isSurfaceOpen: boolean
  surfaceTab: CodeSurfaceTab
  /** 编辑器字号（px） */
  editorFontSize: number
  /** 行高倍数，实际行高 = 字号 × 倍数 */
  editorLineHeightRatio: number
  /** 等宽字体族；空串表示用内置的等宽栈 */
  editorFontFamily: string
  isEditorLigaturesEnabled: boolean
  editorWordWrap: CodeWordWrap
  editorWordWrapColumn: number
  isEditorMinimapEnabled: boolean
  isEditorStickyScrollEnabled: boolean
  editorRenderWhitespace: CodeRenderWhitespace
  isEditorBracketGuidesEnabled: boolean
  isEditorSemanticHighlightingEnabled: boolean
  /** 新文档默认缩进 */
  editorTabSize: number
  isEditorInsertSpaces: boolean
  /** 资源管理器是否显示 `.` 开头的隐藏条目 */
  isHiddenVisible: boolean
  tsTypesMode: 'full' | 'lean' | 'off'
}

interface SignboardShell {
  activeBoardID: string | null
  viewModeByBoard: Record<string, SignboardViewMode>
}

interface BookmarkShell {
  viewMode: BookmarkViewMode
  sortKey: BookmarkSortKey
}

interface TilesPref {
  sessions: TileSessionPref[]
  knowledge: KnowledgeShell
  code: CodeShell
  signboard: SignboardShell
  bookmark: BookmarkShell
}

interface ModelPref {
  visible: boolean
  thinking: ThinkingLevel
  contextWindow: number
}

interface AgentSplitterOpen {
  isSidebarOpen: boolean
  isAsideOpen: boolean
  /** 右栏占满主区分栏（中栏收起）；仅按钮 / 快捷键切换 */
  isAsideMaximized?: boolean
}

interface AgentPref {
  splitterLayout: Record<string, number> | null
  splitterOpen: AgentSplitterOpen
  /** 新会话的默认审批档（老会话用自己的 `approvalByThread`） */
  approvalMode: ApprovalMode
  /** 新会话的默认模式 */
  agentMode: AgentMode
  /** 会话级模式（threadID → 模式）；缺省回落新会话默认值 */
  modeByThread: Record<string, AgentMode>
  /** 会话级审批档（threadID → 审批）；缺省回落新会话默认值 */
  approvalByThread: Record<string, ApprovalMode>
  modelPrefs: Record<string, ModelPref>
  /** 当前文件夹（workspaceID → 文件夹路径）；审阅 / 文件 / 提交历史共用 */
  activeRootByWorkspace: Record<string, string>
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

/** Agent 浏览器 omnibox 本地访问记录（跨会话） */
interface BrowserVisit {
  url: string
  title: string
  visitedAt: number
}

interface WindowPref {
  appearance: WindowAppearance
  clockStyle: ClockStyle
  engineKey: string
  recentHits: CommandBarRecentHit[]
  /** Agent 右侧浏览器最近访问，供 omnibox 历史建议 */
  browserVisits: BrowserVisit[]
  tiptapRecentColors: string[]
  rememberedUsername: string | null
}

interface GalleryPref {
  /** 预留图库域偏好；PIN 不在此文件 */
  placeholder: true
}

/** 诊断偏好：只放「要不要上报」这类开关，不留任何内容副本 */
interface DiagnosticsPref {
  /** 崩溃现场是否自动补报到 `POST /api/v1/exception`；关掉后现场只留在本地 */
  reportCrashes: boolean
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

interface SettingsCaptureStyle {
  color: string
  thickness: number
  filled: boolean
  opacity: number
  fontSize: number
}

interface SettingsCapture {
  detect: 'off' | 'window' | 'element'
  isRetentionEnabled: boolean
  retention: {
    screenshot: SettingsCaptureRetention
    recording: SettingsCaptureRetention
  }
  style: SettingsCaptureStyle
}

interface SettingsShortcuts {
  version: number
  bindings: Record<string, string>
}

interface SettingsProxy {
  enabled: boolean
  url: string
  bypassLocal: boolean
  acceptInvalidCerts: boolean
}

interface SettingsPref {
  general: SettingsGeneral
  capture: SettingsCapture
  shortcuts: SettingsShortcuts
  proxy: SettingsProxy
}

interface PersistShape {
  settings: SettingsPref
  tiles: TilesPref
  agent: AgentPref
  window: WindowPref
  clipchamp: ClipchampPref
  gallery: GalleryPref
  vault: VaultPref
  diagnostics: DiagnosticsPref
}

type PersistValue<N extends PersistNamespace> = PersistShape[N]

export type {
  PersistShape,
  PersistValue,
  TileSessionPref,
  KnowledgeShell,
  CodeShell,
  SignboardShell,
  BookmarkShell,
  TilesPref,
  AgentPref,
  AgentSplitterOpen,
  ModelPref,
  WindowPref,
  WindowAppearance,
  BrowserVisit,
  CommandBarRecentHit,
  GalleryPref,
  VaultPref,
  DiagnosticsPref,
  ClipchampPref,
  SettingsPref,
  SettingsProxy,
  SettingsCaptureStyle,
  CodeSidebarView,
  CodeSurfaceTab,
  CodeWordWrap,
  CodeRenderWhitespace,
  KnowledgeViewMode,
  SignboardViewMode,
  BookmarkViewMode,
  BookmarkSortKey,
  ClockStyle,
  ApprovalMode,
  AgentMode,
  ThinkingLevel
}
