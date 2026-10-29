/**
 * Agent 三栏：栏宽 + 开合状态持久化。
 *
 * 夹取 / 吸附 / 收起交给 `react-resizable-panels`；这里只管默认值与存档（agent.json）。
 */

import { findPref, patchPref, type AgentSplitterOpen } from '@/features/persist'

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
type SplitterOpen = AgentSplitterOpen

const PANE_IDS = [SESSION_ID, MAIN_ID, PLAN_ID]

const OPEN_STATE: SplitterOpen = {
  isSidebarOpen: true,
  isAsideOpen: true
}

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

  return total > 0 ? layout : undefined
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
  return { ...findPref('agent').splitterOpen }
}

function writeSplitterOpen(open: SplitterOpen): void {
  void patchPref('agent', {
    splitterOpen: {
      isSidebarOpen: open.isSidebarOpen,
      isAsideOpen: open.isAsideOpen
    }
  })
}

export {
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
  OPEN_STATE,
  findSplitterLayout,
  writeSplitterLayout,
  findSplitterOpen,
  writeSplitterOpen
}
export type { SplitterLayout, SplitterOpen }
