import { describe, expect, it } from 'vitest'

import { findSiteMark } from './mark'

describe('findSiteMark', function () {
  it('网页环境下用站点图标服务', function () {
    expect(findSiteMark('https://github.com/cogito')).toBe(
      'https://www.google.com/s2/favicons?sz=64&domain=github.com'
    )
  })

  it('非 http 链接不生成图标', function () {
    expect(findSiteMark('chrome://newtab')).toBeNull()
  })

  it('非法链接返回空', function () {
    expect(findSiteMark('not a url')).toBeNull()
  })
})
