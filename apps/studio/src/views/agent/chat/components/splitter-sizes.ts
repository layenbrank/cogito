/**
 * Agent 三栏的栏宽与布局持久化。
 *
 * 夹取与折叠交给 `@cogito/design/components/splitter`（`min` / `max` / `collapsible`）。
 * 这里只管：**默认值**、**记住上次拖到哪**、**左右栏开合**。
 *
 * pane id 参与持久化的键，必须与 `views/agent/chat/chat.tsx` 里的一致。
 */

const STORAGE_KEY = 'studio.agent.splitter'

const SIDEBAR_ID = 'agent-sidebar'
const MAIN_ID = 'agent-main'
const PANEL_ID = 'agent-aside'

/** 单位是像素：库把数字当 px 解释（无单位的字符串才是百分比） */
const SIDEBAR_SIZE = 260
const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 420

/** 任务详情内容变多（运行 / 计划 / 变更 / 用量 / 模型…），默认宽与上限一并放宽 */
const PANEL_SIZE = 320
const PANEL_MIN = 240
const PANEL_MAX = 560

/** 中栏（对话）的最小宽度；留不下时库会先把可收起的栏收掉 */
const MAIN_MIN = 360

const SIDEBAR_OPEN = true
const ASIDE_OPEN = false

/** 库的 `Layout` 是「面板 id → flexGrow」，我们不解释它，原样存回去 */
type SplitterLayout = Record<string, number>

interface SplitterState {
  layout?: SplitterLayout
  isSidebarOpen: boolean
  isAsideOpen: boolean
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

function parseSplitterState(raw: string | null): SplitterState {
  const fallback: SplitterState = {
    isSidebarOpen: SIDEBAR_OPEN,
    isAsideOpen: ASIDE_OPEN
  }
  if (!raw) return fallback

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback

    const record = parsed as Record<string, unknown>

    // 旧格式：直接存 layout（`{ "agent-sidebar": 232, ... }`）
    const looksLikeLayoutOnly = Object.values(record).every(function (value) {
      return typeof value === 'number'
    })
    if (looksLikeLayoutOnly) {
      return {
        layout: parseSplitterLayout(record),
        isSidebarOpen: SIDEBAR_OPEN,
        isAsideOpen: ASIDE_OPEN
      }
    }

    return {
      layout: parseSplitterLayout(record.layout),
      isSidebarOpen:
        typeof record.isSidebarOpen === 'boolean' ? record.isSidebarOpen : SIDEBAR_OPEN,
      isAsideOpen: typeof record.isAsideOpen === 'boolean' ? record.isAsideOpen : ASIDE_OPEN
    }
  } catch (error) {
    console.warn('[agent] 分栏布局存档损坏，回落默认', error)
    return fallback
  }
}

function findSplitterState(): SplitterState {
  if (typeof localStorage === 'undefined') {
    return { isSidebarOpen: SIDEBAR_OPEN, isAsideOpen: ASIDE_OPEN }
  }
  return parseSplitterState(localStorage.getItem(STORAGE_KEY))
}

/** @deprecated 用 `findSplitterState().layout`；保留给旧测试与过渡调用 */
function findSplitterLayout(): SplitterLayout | undefined {
  return findSplitterState().layout
}

function writeSplitterState(state: SplitterState): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      layout: state.layout,
      isSidebarOpen: state.isSidebarOpen,
      isAsideOpen: state.isAsideOpen
    })
  )
}

function writeSplitterLayout(layout: SplitterLayout): void {
  const current = findSplitterState()
  writeSplitterState({ ...current, layout })
}

export {
  STORAGE_KEY,
  SIDEBAR_ID,
  MAIN_ID,
  PANEL_ID,
  SIDEBAR_SIZE,
  SIDEBAR_MIN,
  SIDEBAR_MAX,
  PANEL_SIZE,
  PANEL_MIN,
  PANEL_MAX,
  MAIN_MIN,
  SIDEBAR_OPEN,
  ASIDE_OPEN,
  parseSplitterLayout,
  parseSplitterState,
  findSplitterState,
  findSplitterLayout,
  writeSplitterState,
  writeSplitterLayout
}
export type { SplitterLayout, SplitterState }
