import { afterEach, describe, expect, it } from 'vitest'

import { ENGINE_STORE_KEY, ENGINES } from '@/constants/engine'
import {
  parseEngineKey,
  readEngineKey,
  writeEngineKey
} from '@/views/browser/engine/engine-store'

describe('engine store', function () {
  afterEach(function () {
    localStorage.removeItem(ENGINE_STORE_KEY)
  })

  it('falls back to the first engine for unknown payloads', function () {
    expect(parseEngineKey(null)).toBe(ENGINES[0].key)
    expect(parseEngineKey({ key: 'unknown' })).toBe(ENGINES[0].key)
  })

  it('round-trips the selected engine key', function () {
    writeEngineKey('baidu')
    expect(readEngineKey()).toBe('baidu')
    expect(JSON.parse(localStorage.getItem(ENGINE_STORE_KEY) ?? '{}')).toEqual({ key: 'baidu' })
  })
})
