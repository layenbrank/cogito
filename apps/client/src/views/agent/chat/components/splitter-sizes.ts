/**
 * Agent 三栏：栏宽 + 开合状态持久化。
 *
 * 夹取 / 吸附 / 收起交给 `react-resizable-panels`；这里只管默认值与存档。
 */

const SPLITTER_STORAGE_KEY = 'agent.splitter.sizes'
const OPEN_STORAGE_KEY = 'agent.splitter.open'

const SESSION_ID = 'agent-session'
const MAIN_ID = 'agent-main'
const PLAN_ID = 'agent-plan'

/** 单位是像素：库把数字当 px 解释 */
const SESSION_SIZE = 260
const SESSION_MIN = 200
const SESSION_MAX = 420

const WORKBENCH_MIN = 360

const PLAN_SIZE = 320
const PLAN_MIN = 240
const PLAN_MAX = 480

type SplitterLayout = Record<string, number>

interface SplitterOpen {
  isSidebarOpen: boolean
  isAsideOpen: boolean
}

const PANEL_IDS = [SESSION_ID, MAIN_ID, PLAN_ID]

const OPEN_STATE: SplitterOpen = {
  isSidebarOpen: true,
  isAsideOpen: true
}

function parseSplitterLayout(raw: unknown): SplitterLayout | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined

  const record = raw as Record<string, unknown>
  const layout: SplitterLayout = {}
  let total = 0

  for (const id of PANEL_IDS) {
    const value = record[id]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
    layout[id] = value
    total += value
  }

  return total > 0 ? layout : undefined
}

function findSplitterLayout(): SplitterLayout | undefined {
  if (typeof localStorage === 'undefined') return undefined
  const raw = localStorage.getItem(SPLITTER_STORAGE_KEY)
  if (!raw) return undefined
  try {
    return parseSplitterLayout(JSON.parse(raw))
  } catch (error) {
    console.warn('[agent] 分栏布局存档损坏，回落默认', error)
    return undefined
  }
}

function writeSplitterLayout(layout: SplitterLayout): void {
  if (typeof localStorage === 'undefined') return
  const next = parseSplitterLayout(layout)
  if (!next) return
  localStorage.setItem(SPLITTER_STORAGE_KEY, JSON.stringify(next))
}

function parseSplitterOpen(raw: unknown): SplitterOpen | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  if (typeof record.isSidebarOpen !== 'boolean' || typeof record.isAsideOpen !== 'boolean') {
    return undefined
  }
  return {
    isSidebarOpen: record.isSidebarOpen,
    isAsideOpen: record.isAsideOpen
  }
}

function findSplitterOpen(): SplitterOpen {
  if (typeof localStorage === 'undefined') return { ...OPEN_STATE }
  const raw = localStorage.getItem(OPEN_STORAGE_KEY)
  if (!raw) return { ...OPEN_STATE }
  try {
    return parseSplitterOpen(JSON.parse(raw)) ?? { ...OPEN_STATE }
  } catch (error) {
    console.warn('[agent] 分栏开合存档损坏，回落默认', error)
    return { ...OPEN_STATE }
  }
}

function writeSplitterOpen(open: SplitterOpen): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(OPEN_STORAGE_KEY, JSON.stringify(open))
}

export {
  SPLITTER_STORAGE_KEY,
  OPEN_STORAGE_KEY,
  SESSION_ID,
  MAIN_ID,
  PLAN_ID,
  SESSION_SIZE,
  SESSION_MIN,
  SESSION_MAX,
  WORKBENCH_MIN,
  PLAN_SIZE,
  PLAN_MIN,
  PLAN_MAX,
  findSplitterLayout,
  writeSplitterLayout,
  findSplitterOpen,
  writeSplitterOpen
}
export type { SplitterLayout, SplitterOpen }
