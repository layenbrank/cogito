import { afterEach, describe, expect, it } from 'vitest'

import { ENGINE_STORE_KEY, ENGINES } from '@/constants/engine'
import {
  parseEngineKey,
  readEngineKey,
  RECENT_STORE_KEY,
  readRecentHits,
  writeEngineKey,
  writeRecentHit
} from '@/features/command-bar/store'

describe('command-bar store', function () {
  afterEach(function () {
    localStorage.removeItem(ENGINE_STORE_KEY)
    localStorage.removeItem(RECENT_STORE_KEY)
  })

  it('falls back to the first engine for unknown payloads', function () {
    expect(parseEngineKey(null)).toBe(ENGINES[0].key)
    expect(parseEngineKey({ key: 'unknown' })).toBe(ENGINES[0].key)
  })

  it('round-trips the selected engine key', function () {
    writeEngineKey('baidu')
    expect(readEngineKey()).toBe('baidu')
    expect(JSON.parse(localStorage.getItem(ENGINE_STORE_KEY) ?? '{}')).toEqual({
      key: 'baidu'
    })
  })

  it('stores recent hits with dedupe', function () {
    writeRecentHit({
      domain: 'tile',
      id: 'a',
      title: 'Alpha'
    })
    writeRecentHit({
      domain: 'tile',
      id: 'b',
      title: 'Beta'
    })
    writeRecentHit({
      domain: 'tile',
      id: 'a',
      title: 'Alpha'
    })
    const recent = readRecentHits()
    expect(recent.map(function (item) {
      return item.id
    })).toEqual(['a', 'b'])
  })
})
