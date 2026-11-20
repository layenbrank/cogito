import { describe, expect, it } from 'vitest'

import { isDarkTheme, parseTheme } from './theme'

describe('parseTheme', function () {
  it('只接受三种取值', function () {
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme('nope')).toBe('system')
    expect(parseTheme(null)).toBe('system')
  })
})

describe('isDarkTheme', function () {
  it('跟随系统时看 prefers-color-scheme', function () {
    expect(isDarkTheme('system', true)).toBe(true)
    expect(isDarkTheme('system', false)).toBe(false)
    expect(isDarkTheme('light', true)).toBe(false)
  })
})
