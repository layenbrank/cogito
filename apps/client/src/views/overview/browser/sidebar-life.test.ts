import { describe, expect, it } from 'vitest'

import { findPageMark, lifeLabel, type PageLife } from '@/views/overview/browser/sidebar'

describe('findPageMark', function () {
  const lives: Record<string, PageLife> = {
    open: 'ok',
    broken: 'fail',
    pending: 'wait'
  }

  it('keeps a loaded webview green even when it is not the selected row', function () {
    expect(findPageMark(lives, 'open')).toBe('ok')
    expect(lifeLabel('ok')).toBe('已打开')
  })

  it('marks a webview that failed to load', function () {
    expect(findPageMark(lives, 'broken')).toBe('fail')
    expect(lifeLabel('fail')).toBe('加载失败')
  })

  it('marks a missing webview as not open', function () {
    expect(findPageMark(lives, 'missing')).toBe('shut')
    expect(lifeLabel('shut')).toBe('未打开')
  })
})
