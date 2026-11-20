import { describe, expect, it } from 'vitest'

import { parseSiteUrl } from './url'

describe('parseSiteUrl', function () {
  it('规范化 http(s)', function () {
    expect(parseSiteUrl(' https://github.com/cogito ')).toBe('https://github.com/cogito')
  })

  it('拒绝内部页和空字符串', function () {
    expect(parseSiteUrl('chrome://extensions')).toBeNull()
    expect(parseSiteUrl('   ')).toBeNull()
    expect(parseSiteUrl('not a url')).toBeNull()
  })
})
