import { beforeEach, describe, expect, it } from 'vitest'

import {
  ensurePersist,
  findPref,
  patchPref,
  replacePref,
  resetPersistForTests,
  STORE_FILE
} from '@/features/persist'
import { parseNamespace, parseSignboardViewMode } from '@/features/persist/parse'

describe('persist STORE_FILE', function () {
  it('maps every namespace to a single-word json file', function () {
    for (const [ns, file] of Object.entries(STORE_FILE)) {
      expect(file).toBe(`${ns}.json`)
      expect(file.includes('-')).toBe(false)
    }
  })
})

describe('persist parse', function () {
  it('accepts known signboard view modes', function () {
    expect(parseSignboardViewMode('board')).toBe('board')
    expect(parseSignboardViewMode('stats')).toBe('stats')
    expect(parseSignboardViewMode('nope')).toBeNull()
  })

  it('parses tiles bookmark + signboard patches', function () {
    const parsed = parseNamespace('tiles', {
      bookmark: { viewMode: 'grid', sortKey: 'name-asc' },
      signboard: {
        activeBoardID: 'b1',
        viewModeByBoard: { b1: 'gantt', bad: 'zzz' }
      }
    })
    expect(parsed.bookmark.viewMode).toBe('grid')
    expect(parsed.bookmark.sortKey).toBe('name-asc')
    expect(parsed.signboard.activeBoardID).toBe('b1')
    expect(parsed.signboard.viewModeByBoard).toEqual({ b1: 'gantt' })
  })
})

describe('persist store (memory)', function () {
  beforeEach(async function () {
    resetPersistForTests()
    await ensurePersist()
  })

  it('round-trips window appearance via patchPref', async function () {
    await patchPref('window', {
      appearance: {
        mode: 'dark',
        motion: 'off',
        color: '#4080ff',
        foreground: '#ffffff',
        radius: 6
      }
    })
    expect(findPref('window').appearance.mode).toBe('dark')
    expect(findPref('window').appearance.radius).toBe(6)
  })

  it('deep-merges tiles.knowledge without wiping siblings', async function () {
    await patchPref('tiles', {
      knowledge: { ...findPref('tiles').knowledge, fontSize: 20 }
    })
    await patchPref('tiles', {
      code: { ...findPref('tiles').code, isPanelOpen: true }
    })
    const tiles = findPref('tiles')
    expect(tiles.knowledge.fontSize).toBe(20)
    expect(tiles.code.isPanelOpen).toBe(true)
    expect(tiles.bookmark.viewMode).toBe('list')
  })

  it('replaces clipchamp blob wholesale', async function () {
    await replacePref('clipchamp', { project: { name: 'demo' }, assets: [] })
    expect(findPref('clipchamp')).toEqual({ project: { name: 'demo' }, assets: [] })
    await replacePref('clipchamp', {})
    expect(findPref('clipchamp')).toEqual({})
  })

  it('keeps vault pinHash out of gallery', async function () {
    await patchPref('vault', { pinHash: 'abc' })
    expect(findPref('vault').pinHash).toBe('abc')
    expect(findPref('gallery')).toEqual({ placeholder: true })
  })
})
