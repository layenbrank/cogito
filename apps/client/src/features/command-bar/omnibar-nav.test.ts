import { describe, expect, it } from 'vitest'

import { OMNIBAR_UI } from '@/features/command-bar/constants'
import { parseQuery } from '@/features/command-bar/query'
import { findDefaultNavigation } from '@/features/command-bar/url'

/**
 * 覆盖 Omnibar 交互约定（纯函数侧）：
 * - 网址不预选结果，Enter 走地址栏提交
 * - 普通查询预选首条
 * - 前缀过滤覆盖 chip
 */
describe('omnibar interaction contracts', function () {
  it('url keyword keeps navigation at NONE so Enter submits the address', function () {
    expect(findDefaultNavigation('github.com')).toBe(OMNIBAR_UI.NONE)
    expect(findDefaultNavigation('https://example.com/a')).toBe(OMNIBAR_UI.NONE)
  })

  it('plain query preselects the first hit', function () {
    expect(findDefaultNavigation('rust')).toBe(0)
    expect(findDefaultNavigation('')).toBe(0)
  })

  it('domain prefix overrides the active chip filter', function () {
    expect(parseQuery('web:rust', 'agent').filter).toBe('web')
    expect(parseQuery('cal:周会', 'all').filter).toBe('calendar')
    expect(parseQuery('rust', 'agent').filter).toBe('agent')
  })
})
