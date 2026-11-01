import { describe, expect, it } from 'vitest'

import { parseSplitterLayout, parseSplitterState } from './splitter-sizes'

/**
 * 这里测的是**存储容错**：栏宽夹取交给 Splitter，
 * 剩下的风险是 localStorage 脏数据 —— 宁可回落到默认分配。
 */

describe('parseSplitterLayout', function () {
  it('returns undefined for missing storage', function () {
    expect(parseSplitterLayout(null)).toBeUndefined()
    expect(parseSplitterLayout(undefined)).toBeUndefined()
  })

  it('returns undefined for non-object payloads', function () {
    expect(parseSplitterLayout(42)).toBeUndefined()
    expect(parseSplitterLayout('agent-sidebar')).toBeUndefined()
    expect(parseSplitterLayout([])).toBeUndefined()
  })

  it('keeps positive numeric entries', function () {
    expect(parseSplitterLayout({ 'agent-sidebar': 260, 'agent-aside': 280 })).toEqual({
      'agent-sidebar': 260,
      'agent-aside': 280
    })
  })

  it('drops entries that are not positive finite numbers', function () {
    expect(
      parseSplitterLayout({ a: 0, b: -5, c: '232', d: null, e: true, f: 232 })
    ).toEqual({
      f: 232
    })
  })

  it('returns undefined when nothing survives filtering', function () {
    expect(parseSplitterLayout({ a: 0, b: 'x' })).toBeUndefined()
  })
})

describe('parseSplitterState', function () {
  it('falls back to defaults for missing storage', function () {
    expect(parseSplitterState(null)).toEqual({
      isSidebarOpen: true,
      isAsideOpen: false
    })
  })

  it('falls back for broken JSON', function () {
    expect(parseSplitterState('{not json')).toEqual({
      isSidebarOpen: true,
      isAsideOpen: false
    })
  })

  it('accepts legacy layout-only payloads', function () {
    expect(parseSplitterState('{"agent-sidebar":232,"agent-aside":300}')).toEqual({
      layout: { 'agent-sidebar': 232, 'agent-aside': 300 },
      isSidebarOpen: true,
      isAsideOpen: false
    })
  })

  it('reads open flags from the new envelope', function () {
    expect(
      parseSplitterState(
        JSON.stringify({
          layout: { 'agent-sidebar': 260 },
          isSidebarOpen: false,
          isAsideOpen: true
        })
      )
    ).toEqual({
      layout: { 'agent-sidebar': 260 },
      isSidebarOpen: false,
      isAsideOpen: true
    })
  })
})
