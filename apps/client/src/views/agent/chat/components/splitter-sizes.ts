/**
 * Agent 三栏：栏宽 + 开合状态持久化。
 *
 * 两套尺寸不要混：
 * - **偏好宽度**（preferred）：拖拽记住的展开比例，折叠栏保持上次非 0，永不被 0 覆盖
 * - **应用布局**（applied = resolveSplitterLayout(open, preferred)）：真正 setLayout 的值
 *
 * 最小化/恢复必须回放 applied，不能回放「偏好里的展开比例」再 collapse —— 否则先展开再收起。
 *
 * `LAYOUT_WIDTH_GUARD`：客户区假窄时冻结拖拽。
 */

import { findPref, patchPref, type AgentSplitterOpen } from '@/features/persist'

const SESSION_ID = 'agent-session'
const MAIN_ID = 'agent-main'
const PLAN_ID = 'agent-plan'

/**
 * 无存档时的像素默认（与主窗 1120 对齐）：
 * 260 / 520 / 340 ≈ 23% / 46% / 30%，中栏会话为主。
 */
const SESSION_SIZE = 260
const SESSION_MIN = 220
/** 硬上限：左栏只承载会话列表，避免吃掉中栏 */
const SESSION_MAX = 300

/**
 * 中栏（会话）吃窗口伸缩余量；占满模式会把中栏折叠到 0。
 */
const WORKBENCH_MIN = 400
const WORKBENCH_SIZE = 520

/** 右栏常看文件 / diff / browser；上限放宽以便拖满主区 */
const PLAN_SIZE = 340
/** 含纵向导航的 48px；再窄内容区就只剩两百出头了 */
const PLAN_MIN = 280
/** 足够盖住常见桌面宽度，拖满时不顶死在 900 */
const PLAN_MAX = 4800

/**
 * 低于此宽度视为「最小化假窄」：正常主窗 minWidth=900，
 * 只有最小化 / 异常壳会掉到一百多 px。
 */
const LAYOUT_WIDTH_GUARD = 400

type SplitterLayout = Record<string, number>
/** 运行时开关态：三项齐全；persist 的可选字段读入时会 Boolean 归一 */
type SplitterOpen = Required<AgentSplitterOpen>

const PANE_IDS = [SESSION_ID, MAIN_ID, PLAN_ID]

const OPEN_STATE: SplitterOpen = {
  isSidebarOpen: true,
  isAsideOpen: true,
  isAsideMaximized: false
}

/** 无存档时的百分比兜底（与上面像素默认同比例） */
const FALLBACK_LAYOUT: SplitterLayout = {
  [SESSION_ID]: 23.214,
  [MAIN_ID]: 46.429,
  [PLAN_ID]: 30.357
}

/** 栏宽低于此 % 视为已折叠（库浮点误差） */
const COLLAPSED_PCT = 0.5

function isSameSplitterLayout(left: SplitterLayout, right: SplitterLayout): boolean {
  for (const id of PANE_IDS) {
    const a = left[id]
    const b = right[id]
    if (typeof a !== 'number' || typeof b !== 'number') return false
    if (Math.abs(a - b) > 0.05) return false
  }
  return true
}

function findPanePreferred(
  raw: number | undefined,
  fallback: number
): number {
  return typeof raw === 'number' && raw > COLLAPSED_PCT ? raw : fallback
}

/**
 * 从存档得到「偏好宽度」：各栏都是展开时应用的比例，0 / 脏值用 FALLBACK 补。
 */
function findPreferredLayout(stored?: SplitterLayout): SplitterLayout {
  const base = stored ?? FALLBACK_LAYOUT
  return {
    [SESSION_ID]: findPanePreferred(base[SESSION_ID], FALLBACK_LAYOUT[SESSION_ID] ?? 0),
    [MAIN_ID]: findPanePreferred(base[MAIN_ID], FALLBACK_LAYOUT[MAIN_ID] ?? 0),
    [PLAN_ID]: findPanePreferred(base[PLAN_ID], FALLBACK_LAYOUT[PLAN_ID] ?? 0)
  }
}

/**
 * 拖拽结束后合并偏好：只吸收当前展开栏的新比例，折叠栏保留旧偏好。
 */
function mergePreferredLayout(
  preferred: SplitterLayout,
  dragged: SplitterLayout,
  open: SplitterOpen
): SplitterLayout {
  if (open.isAsideMaximized) return preferred

  const session = open.isSidebarOpen
    ? findPanePreferred(dragged[SESSION_ID], preferred[SESSION_ID] ?? FALLBACK_LAYOUT[SESSION_ID] ?? 0)
    : findPanePreferred(preferred[SESSION_ID], FALLBACK_LAYOUT[SESSION_ID] ?? 0)
  const plan = open.isAsideOpen
    ? findPanePreferred(dragged[PLAN_ID], preferred[PLAN_ID] ?? FALLBACK_LAYOUT[PLAN_ID] ?? 0)
    : findPanePreferred(preferred[PLAN_ID], FALLBACK_LAYOUT[PLAN_ID] ?? 0)
  const main = Math.max(0, 100 - session - plan)

  return {
    [SESSION_ID]: session,
    [MAIN_ID]: main > COLLAPSED_PCT ? main : (FALLBACK_LAYOUT[MAIN_ID] ?? 0),
    [PLAN_ID]: plan
  }
}

/**
 * 把存档比例与开合偏好合成首屏 layout。
 * 避免「先按三栏全开画一帧，再用 expand/collapse 过渡」的闪烁。
 */
function resolveSplitterLayout(
  open: SplitterOpen,
  stored?: SplitterLayout
): SplitterLayout {
  if (open.isAsideMaximized) {
    return {
      [SESSION_ID]: 0,
      [MAIN_ID]: 0,
      [PLAN_ID]: 100
    }
  }

  const base = stored ?? FALLBACK_LAYOUT
  const sessionRaw = base[SESSION_ID] ?? FALLBACK_LAYOUT[SESSION_ID] ?? 0
  const planRaw = base[PLAN_ID] ?? FALLBACK_LAYOUT[PLAN_ID] ?? 0

  const sessionPct = open.isSidebarOpen
    ? sessionRaw > COLLAPSED_PCT
      ? sessionRaw
      : (FALLBACK_LAYOUT[SESSION_ID] ?? 0)
    : 0
  const planPct = open.isAsideOpen
    ? planRaw > COLLAPSED_PCT
      ? planRaw
      : (FALLBACK_LAYOUT[PLAN_ID] ?? 0)
    : 0

  const mainPct = 100 - sessionPct - planPct
  if (mainPct >= COLLAPSED_PCT) {
    return {
      [SESSION_ID]: sessionPct,
      [MAIN_ID]: mainPct,
      [PLAN_ID]: planPct
    }
  }

  // 存档被最小化污染时，按开着的栏用兜底比例重分
  const fallbackSession = open.isSidebarOpen ? (FALLBACK_LAYOUT[SESSION_ID] ?? 0) : 0
  const fallbackPlan = open.isAsideOpen ? (FALLBACK_LAYOUT[PLAN_ID] ?? 0) : 0
  const fallbackMain = FALLBACK_LAYOUT[MAIN_ID] ?? 0
  const total = fallbackSession + fallbackMain + fallbackPlan
  if (total <= 0) {
    return { [SESSION_ID]: 0, [MAIN_ID]: 100, [PLAN_ID]: 0 }
  }
  return {
    [SESSION_ID]: (fallbackSession / total) * 100,
    [MAIN_ID]: (fallbackMain / total) * 100,
    [PLAN_ID]: (fallbackPlan / total) * 100
  }
}

/**
 * 解析存档布局。库约定为百分比 0..100。
 * 旧版误把像素写入时（任一值 > 100），按总和折成百分比迁移。
 */
function parseSplitterLayout(raw: unknown): SplitterLayout | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined

  const record = raw as Record<string, unknown>
  const layout: SplitterLayout = {}
  let total = 0

  for (const id of PANE_IDS) {
    const value = record[id]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
    layout[id] = value
    total += value
  }

  if (total <= 0) return undefined

  const isPixelLayout = PANE_IDS.some(function (id) {
    return (layout[id] ?? 0) > 100
  })

  if (!isPixelLayout) return layout

  // 旧存档：把 px 当 layout 存，读回时又被 Math.max(PLAN_MIN, pct) 夹成 280 —— 整表按比例迁成 %
  const next: SplitterLayout = {}
  for (const id of PANE_IDS) {
    next[id] = ((layout[id] ?? 0) / total) * 100
  }
  return next
}

function findSplitterLayout(): SplitterLayout | undefined {
  const layout = findPref('agent').splitterLayout
  return layout ? parseSplitterLayout(layout) : undefined
}

function writeSplitterLayout(layout: SplitterLayout): void {
  const next = parseSplitterLayout(layout)
  if (!next) return
  void patchPref('agent', { splitterLayout: next })
}

function findSplitterOpen(): SplitterOpen {
  const open = findPref('agent').splitterOpen
  return {
    isSidebarOpen: open.isSidebarOpen,
    isAsideOpen: open.isAsideOpen,
    isAsideMaximized: Boolean(open.isAsideMaximized)
  }
}

function writeSplitterOpen(open: SplitterOpen): void {
  void patchPref('agent', {
    splitterOpen: {
      isSidebarOpen: open.isSidebarOpen,
      isAsideOpen: open.isAsideOpen,
      isAsideMaximized: Boolean(open.isAsideMaximized)
    }
  })
}

export {
  COLLAPSED_PCT,
  FALLBACK_LAYOUT,
  findPreferredLayout,
  findSplitterLayout,
  findSplitterOpen,
  isSameSplitterLayout,
  LAYOUT_WIDTH_GUARD,
  MAIN_ID,
  mergePreferredLayout,
  OPEN_STATE,
  parseSplitterLayout,
  PLAN_ID,
  PLAN_MAX,
  PLAN_MIN,
  PLAN_SIZE,
  resolveSplitterLayout,
  SESSION_ID,
  SESSION_MAX,
  SESSION_MIN,
  SESSION_SIZE,
  WORKBENCH_MIN,
  WORKBENCH_SIZE,
  writeSplitterLayout,
  writeSplitterOpen
}
export type { SplitterLayout, SplitterOpen }
