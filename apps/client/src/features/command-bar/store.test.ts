import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ENGINES } from '@/constants/engine'
import {
  parseEngineKey,
  readEngineKey,
  readRecentHits,
  writeEngineKey,
  writeRecentHit
} from '@/features/command-bar/store'
import { ensurePersist, resetPersistForTests } from '@/features/persist'

describe('command-bar store', function () {
  beforeEach(async function () {
    resetPersistForTests()
    await ensurePersist()
  })

  afterEach(function () {
    resetPersistForTests()
  })

  it('falls back to the first engine for unknown payloads', function () {
    expect(parseEngineKey(null)).toBe(ENGINES[0].key)
    expect(parseEngineKey({ key: 'unknown' })).toBe(ENGINES[0].key)
  })

  it('round-trips the selected engine key', async function () {
    await writeEngineKey('baidu')
    expect(readEngineKey()).toBe('baidu')
  })

  it('stores recent hits with dedupe', async function () {
    await writeRecentHit({
      domain: 'tile',
      id: 'a',
      title: 'Alpha'
    })
    await writeRecentHit({
      domain: 'tile',
      id: 'b',
      title: 'Beta'
    })
    await writeRecentHit({
      domain: 'tile',
      id: 'a',
      title: 'Alpha'
    })
    const recent = readRecentHits()
    expect(
      recent.map(function (item) {
        return item.id
      })
    ).toEqual(['a', 'b'])
  })
})
