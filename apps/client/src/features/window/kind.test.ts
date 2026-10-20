import { describe, expect, it } from 'vitest'

import { findPopupLabel, isBrowserWindow, isPopupWindow } from '@/features/window/kind'

describe('isBrowserWindow', function () {
  it('accepts the first window and numbered ones', function () {
    expect(isBrowserWindow('browser')).toBe(true)
    expect(isBrowserWindow('browser-2')).toBe(true)
    expect(isBrowserWindow('browser-11')).toBe(true)
  })

  it('rejects other windows and malformed labels', function () {
    expect(isBrowserWindow('main')).toBe(false)
    expect(isBrowserWindow('browser-')).toBe(false)
    expect(isBrowserWindow('browser-x')).toBe(false)
    expect(isBrowserWindow('navigation-popup-browser')).toBe(false)
  })
})

describe('isPopupWindow', function () {
  it('recognises a popup of any host', function () {
    expect(isPopupWindow('navigation-popup-browser')).toBe(true)
    expect(isPopupWindow('navigation-popup-browser-2')).toBe(true)
  })

  it('rejects a plain browser window', function () {
    expect(isPopupWindow('browser')).toBe(false)
  })
})

describe('findPopupLabel', function () {
  it('derives the popup label from its host window', function () {
    expect(findPopupLabel('browser')).toBe('navigation-popup-browser')
    expect(findPopupLabel('browser-3')).toBe('navigation-popup-browser-3')
  })
})
