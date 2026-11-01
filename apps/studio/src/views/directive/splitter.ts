/**
 * 指令页的栏宽与布局持久化。
 *
 * 编排台（`workspace.tsx`）是两层嵌套的可拖分栏：外层「列表 | 工作区」，工作区内「编辑器 / 运行台」
 * 上下叠；卡片墙（`directive.tsx`）只用其中的运行台一项，铺成「墙 / 运行台」。
 * 夹取与折叠交给 `@cogito/design/components/splitter`；这里只管默认尺寸、存档与开合。
 *
 * Pane 尺寸：数字 = 像素，`"N%"` = 百分比。
 * `defaultLayout` 为占比（0..100）。pane id 参与存档键，须与页面一致。
 */

const STORAGE_KEY = 'studio.directive.splitter'

/** 四个分栏组各有一份布局，按组 id 分别存 */
const PAGE_GROUP_ID = 'directive-page'
const STACK_GROUP_ID = 'directive-stack'
const PANEL_GROUP_ID = 'directive-panel'

/** 卡片墙只有「墙 / 运行台」两层，跟编排台的外层不是一套布局，得单独存 */
const WALL_GROUP_ID = 'directive-wall'

const LIST_ID = 'directive-list'
const WORKSPACE_ID = 'directive-workspace'
const WALL_ID = 'directive-wall-panel'
const EDITOR_ID = 'directive-editor'
const RUN_ID = 'directive-run'
const META_ID = 'directive-meta'
const STEPS_ID = 'directive-steps'

const LIST_SIZE = 320
const LIST_MIN = 260
const LIST_MAX = 440

/** 工作区的最小宽度：再窄编辑器就摆不下元信息 + 步骤两栏 */
const WORKSPACE_MIN = 560

/**
 * 上方面板（卡片墙 / 编辑器）最小高度。不宜过大：窗口化时若把运行台挤到有效上限，
 * 占比会被库夹小，最大化后仍按被夹过的比例走，看起来就不在 `RUN_MAX`。
 */
const WALL_MIN = 280
const EDITOR_MIN = WALL_MIN

/** 运行台最小高度（像素） */
const RUN_MIN = 160
/**
 * 展开默认 = 拖动上限，父组百分比。窗口变大时必须再 `resize` 一次，
 * 否则小窗被夹过的占比会一直保留，最大化后还能往上拖。
 */
const RUN_MAX = '35%'

/** 运行台收起后只剩标题栏，高度必须与标题栏（`h-12` = 48px）一致才对得上 */
const RUN_COLLAPSED = 48

const META_SIZE = 300
const META_MIN = 280
const META_MAX = 480

const STEPS_MIN = 360

const LIST_OPEN = true
/** 卡片墙 / 编排台运行台默认收缩，只露标题栏 */
const RUN_OPEN = false

/** 库的 `Layout` 是「面板 id → flexGrow」，我们不解释它，原样存回去 */
type SplitterLayout = Record<string, number>

interface SplitterState {
  /** 组 id → 该组的布局；没拖过的组缺省，由库自行分配 */
  layouts: Record<string, SplitterLayout | undefined>
  isListOpen: boolean
  isRunOpen: boolean
}

interface SplitterOpen {
  isListOpen: boolean
  isRunOpen: boolean
}

/**
 * 存储的容错：只接受正数项。
 * 解析不出任何有效项时返回 `undefined`，让库走自己的默认分配 ——
 * 宁可回到初始布局，也不要拿着半截布局去撑。
 */
function parseSplitterLayout(raw: unknown): SplitterLayout | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined

  const layout: SplitterLayout = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
    layout[id] = value
  }

  return Object.keys(layout).length > 0 ? layout : undefined
}

function parseLayouts(raw: unknown): SplitterState['layouts'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const layouts: SplitterState['layouts'] = {}
  for (const [groupId, value] of Object.entries(raw as Record<string, unknown>)) {
    const layout = parseSplitterLayout(value)
    if (layout) layouts[groupId] = layout
  }

  return layouts
}

function parseSplitterState(raw: string | null): SplitterState {
  const fallback: SplitterState = {
    layouts: {},
    isListOpen: LIST_OPEN,
    isRunOpen: RUN_OPEN
  }
  if (!raw) return fallback

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback

    const record = parsed as Record<string, unknown>

    return {
      layouts: parseLayouts(record.layouts),
      isListOpen: typeof record.isListOpen === 'boolean' ? record.isListOpen : LIST_OPEN,
      isRunOpen: typeof record.isRunOpen === 'boolean' ? record.isRunOpen : RUN_OPEN
    }
  } catch (error) {
    console.warn('[directive] 分栏布局存档损坏，回落默认', error)
    return fallback
  }
}

function findSplitterState(): SplitterState {
  if (typeof localStorage === 'undefined') {
    return { layouts: {}, isListOpen: LIST_OPEN, isRunOpen: RUN_OPEN }
  }
  return parseSplitterState(localStorage.getItem(STORAGE_KEY))
}

function writeSplitterState(state: SplitterState): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      layouts: state.layouts,
      isListOpen: state.isListOpen,
      isRunOpen: state.isRunOpen
    })
  )
}

/** 只更新某一组的布局，开合状态与别的组都留着 */
function writeSplitterLayout(groupId: string, layout: SplitterLayout): void {
  const current = findSplitterState()
  writeSplitterState({
    ...current,
    layouts: { ...current.layouts, [groupId]: layout }
  })
}

/** 收起 / 展开时也存一次：下次打开还得是用户上次看到的样子。只给要改的那一项即可 */
function writeSplitterOpen(open: Partial<SplitterOpen>): void {
  writeSplitterState({ ...findSplitterState(), ...open })
}

/**
 * 运行台收起时，存档里的占比仍可能是上次展开高度。
 * 首帧若原样喂给 Group，会先撑开再 collapse，且 onResize 可能把 isRunOpen 又掰开。
 * 收起态去掉运行台那一项，交给 `collapsedSize`（像素）+ `collapse()`。
 * 展开态一律写成 `RUN_MAX`：卡片墙与编排台各存各的组，不能沿用旧像素时代的占比。
 */
function alignRunLayout(
  layout: SplitterLayout | undefined,
  isRunOpen: boolean
): SplitterLayout | undefined {
  const runPercent = Number.parseFloat(RUN_MAX)
  if (!isRunOpen) {
    if (!layout) return undefined
    const next = { ...layout }
    delete next[RUN_ID]
    return Object.keys(next).length > 0 ? next : undefined
  }
  if (!layout) return { [RUN_ID]: runPercent }
  return { ...layout, [RUN_ID]: runPercent }
}

export {
  EDITOR_ID,
  EDITOR_MIN,
  LIST_ID,
  LIST_MAX,
  LIST_MIN,
  LIST_SIZE,
  META_ID,
  META_MAX,
  META_MIN,
  META_SIZE,
  PAGE_GROUP_ID,
  PANEL_GROUP_ID,
  RUN_COLLAPSED,
  RUN_ID,
  RUN_MAX,
  RUN_MIN,
  STACK_GROUP_ID,
  STEPS_ID,
  STEPS_MIN,
  WALL_GROUP_ID,
  WALL_ID,
  WALL_MIN,
  WORKSPACE_ID,
  WORKSPACE_MIN,
  alignRunLayout,
  findSplitterState,
  writeSplitterLayout,
  writeSplitterOpen
}
