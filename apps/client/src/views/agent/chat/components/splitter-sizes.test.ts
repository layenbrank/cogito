import { describe, expect, it } from 'vitest'

import {
  FALLBACK_LAYOUT,
  findDefaultLayout,
  findPreferredLayout,
  MAIN_ID,
  mergePreferredLayout,
  parseSplitterLayout,
  PLAN_ID,
  PLAN_MIN,
  PLAN_SIZE,
  resolveSplitterLayout,
  SESSION_ID,
  SESSION_MAX,
  SESSION_MIN,
  SESSION_SIZE,
  WORKBENCH_SIZE
} from './splitter-sizes'

describe('resolveSplitterLayout', function () {
  it('maximized aside fills 100%', function () {
    expect(
      resolveSplitterLayout({
        isSidebarOpen: true,
        isAsideOpen: true,
        isAsideMaximized: true
      })
    ).toEqual({
      [SESSION_ID]: 0,
      [MAIN_ID]: 0,
      [PLAN_ID]: 100
    })
  })

  it('keeps stored percentages when both sides open', function () {
    const stored = {
      [SESSION_ID]: 20,
      [MAIN_ID]: 50,
      [PLAN_ID]: 30
    }
    expect(
      resolveSplitterLayout(
        { isSidebarOpen: true, isAsideOpen: true, isAsideMaximized: false },
        stored
      )
    ).toEqual(stored)
  })

  it('zeros closed panes and gives remainder to main', function () {
    const next = resolveSplitterLayout(
      { isSidebarOpen: false, isAsideOpen: true, isAsideMaximized: false },
      {
        [SESSION_ID]: 20,
        [MAIN_ID]: 50,
        [PLAN_ID]: 30
      }
    )
    expect(next[SESSION_ID]).toBe(0)
    expect(next[PLAN_ID]).toBe(30)
    expect(next[MAIN_ID]).toBe(70)
  })

  it('falls back when stored main would collapse', function () {
    const next = resolveSplitterLayout(
      { isSidebarOpen: true, isAsideOpen: true, isAsideMaximized: false },
      {
        [SESSION_ID]: 60,
        [MAIN_ID]: 0.1,
        [PLAN_ID]: 40
      }
    )
    expect(next[MAIN_ID]).toBeGreaterThan(0.5)
    expect(next[SESSION_ID] + next[MAIN_ID] + next[PLAN_ID]).toBeCloseTo(100)
    expect(FALLBACK_LAYOUT[SESSION_ID]).toBeLessThanOrEqual(100)
  })
})

describe('parseSplitterLayout', function () {
  it('migrates legacy pixel maps to percentages', function () {
    const parsed = parseSplitterLayout({
      [SESSION_ID]: 260,
      [MAIN_ID]: 520,
      [PLAN_ID]: 340
    })
    expect(parsed).toBeDefined()
    const total = (parsed?.[SESSION_ID] ?? 0) + (parsed?.[MAIN_ID] ?? 0) + (parsed?.[PLAN_ID] ?? 0)
    expect(total).toBeCloseTo(100)
    expect(parsed?.[SESSION_ID]).toBeLessThanOrEqual(100)
  })

  it('rejects incomplete records', function () {
    expect(parseSplitterLayout({ [SESSION_ID]: 20 })).toBeUndefined()
  })
})

describe('preferred vs applied', function () {
  it('findPreferredLayout replaces collapsed zeros with fallback', function () {
    const preferred = findPreferredLayout({
      [SESSION_ID]: 0,
      [MAIN_ID]: 70,
      [PLAN_ID]: 0
    })
    expect(preferred[SESSION_ID]).toBe(FALLBACK_LAYOUT[SESSION_ID])
    expect(preferred[PLAN_ID]).toBe(FALLBACK_LAYOUT[PLAN_ID])
    expect(preferred[MAIN_ID]).toBe(70)
  })

  it('applied layout stays collapsed when both sides closed', function () {
    const preferred = findPreferredLayout({
      [SESSION_ID]: 20,
      [MAIN_ID]: 50,
      [PLAN_ID]: 30
    })
    const applied = resolveSplitterLayout(
      { isSidebarOpen: false, isAsideOpen: false, isAsideMaximized: false },
      preferred
    )
    expect(applied).toEqual({
      [SESSION_ID]: 0,
      [MAIN_ID]: 100,
      [PLAN_ID]: 0
    })
  })

  it('mergePreferredLayout does not store zeros from a collapsed drag layout', function () {
    const preferred = {
      [SESSION_ID]: 20,
      [MAIN_ID]: 50,
      [PLAN_ID]: 30
    }
    const merged = mergePreferredLayout(
      preferred,
      { [SESSION_ID]: 0, [MAIN_ID]: 100, [PLAN_ID]: 0 },
      { isSidebarOpen: false, isAsideOpen: false, isAsideMaximized: false }
    )
    expect(merged[SESSION_ID]).toBe(20)
    expect(merged[PLAN_ID]).toBe(30)
  })
})
describe('findDefaultLayout', function () {
  function toPixels(width: number) {
    const layout = findDefaultLayout(width)
    return {
      session: ((layout[SESSION_ID] ?? 0) / 100) * width,
      main: ((layout[MAIN_ID] ?? 0) / 100) * width,
      plan: ((layout[PLAN_ID] ?? 0) / 100) * width
    }
  }

  it('keeps the side panes at their pixel defaults on a wide window', function () {
    const px = toPixels(1440)
    expect(px.session).toBeCloseTo(SESSION_SIZE, 0)
    expect(px.plan).toBeCloseTo(PLAN_SIZE, 0)
    expect(px.main).toBeGreaterThan(WORKBENCH_SIZE)
  })

  it('gives extra width to the middle pane instead of stretching the sides', function () {
    const px = toPixels(1600)
    expect(px.session).toBeCloseTo(SESSION_SIZE, 0)
    expect(px.plan).toBeCloseTo(PLAN_SIZE, 0)
  })

  it('never lets the sidebar exceed its hard max', function () {
    expect(toPixels(1920).session).toBeLessThanOrEqual(SESSION_MAX + 0.5)
  })

  it('fits the min window width without overflowing the row', function () {
    const layout = findDefaultLayout(900)
    const total = (layout[SESSION_ID] ?? 0) + (layout[MAIN_ID] ?? 0) + (layout[PLAN_ID] ?? 0)
    expect(total).toBeCloseTo(100, 5)
    const px = toPixels(900)
    expect(px.session).toBeGreaterThanOrEqual(SESSION_MIN - 0.5)
    expect(px.plan).toBeGreaterThanOrEqual(PLAN_MIN - 0.5)
  })

  it('falls back when the container is not measurable', function () {
    expect(findDefaultLayout(0)).toEqual(FALLBACK_LAYOUT)
  })
})
