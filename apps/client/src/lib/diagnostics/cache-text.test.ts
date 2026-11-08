import { describe, expect, it } from 'vitest'

import { cachePruneText, cacheSizeText, stampText } from './cache-text'

describe('cacheSizeText', () => {
  it('清空后显示 0 B，而不是 formatBytes 的占位符「—」', function () {
    expect(cacheSizeText(0)).toBe('0 B')
    expect(cacheSizeText(-1)).toBe('0 B')
  })

  it('读不到（undefined / null）才显示「—」', function () {
    expect(cacheSizeText(undefined)).toBe('—')
    expect(cacheSizeText(null)).toBe('—')
  })

  it('有量级时按 MB / GB 展示', function () {
    expect(cacheSizeText(1024)).toBe('1 KB')
    expect(cacheSizeText(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(cacheSizeText(2 * 1024 * 1024 * 1024)).toBe('2.0 GB')
  })
})

describe('stampText', () => {
  it('本地时区 YYYY-MM-DD HH:mm，月和日补零', function () {
    expect(stampText(new Date(2026, 0, 5, 9, 7).getTime())).toBe('2026-01-05 09:07')
  })

  it('非法值退化文案，不抛错', function () {
    expect(stampText(Number.NaN)).toBe('读不到')
  })
})

describe('cachePruneText', () => {
  it('清理过：同时给出上限、上次清理时间与释放字节', function () {
    const at = new Date(2026, 10, 8, 22, 0).getTime()
    const text = cachePruneText({ maxBytes: 512 * 1024 * 1024, lastPrunedAt: at, lastPrunedBytes: 12 * 1024 * 1024 })
    expect(text).toContain('上限 512.0 MB')
    expect(text).toContain('上次清理 2026-11-08 22:00')
    expect(text).toContain('释放 12.0 MB')
  })

  it('没清理过时说「还没触发过」，不留空', function () {
    const text = cachePruneText({ maxBytes: 512 * 1024 * 1024, lastPrunedAt: null, lastPrunedBytes: 0 })
    expect(text).toContain('还没触发过')
    expect(text).not.toContain('释放')
  })

  it('状态读不到时也给一句话，页面不会出现空白', function () {
    expect(cachePruneText(null)).toBe('读不到缓存状态')
  })
})
