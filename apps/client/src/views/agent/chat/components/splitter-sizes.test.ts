import { describe, expect, it } from 'vitest'

import {
  FALLBACK_LAYOUT,
  findPreferredLayout,
  MAIN_ID,
  mergePreferredLayout,
  parseSplitterLayout,
  PLAN_ID,
  resolveSplitterLayout,
  SESSION_ID
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
    const total =
      (parsed?.[SESSION_ID] ?? 0) + (parsed?.[MAIN_ID] ?? 0) + (parsed?.[PLAN_ID] ?? 0)
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
