import { beforeEach, describe, expect, it } from 'vitest'

import { findNavigationIconSrc, findNavigationLabel, findSiteMark } from './mark'

beforeEach(function () {
  const runtime = {
    getURL(path: string) {
      return `chrome-extension://cogito/${path}`
    }
  }
  Object.assign(globalThis, { chrome: { runtime } })
})

describe('findSiteMark', function () {
  it('用扩展的 favicon 接口', function () {
    expect(findSiteMark('https://github.com/cogito')).toBe(
      'chrome-extension://cogito/_favicon/?pageUrl=https%3A%2F%2Fgithub.com%2Fcogito&size=64'
    )
  })

  it('非 http 链接不生成图标', function () {
    expect(findSiteMark('chrome://newtab')).toBeNull()
  })

  it('非法链接返回空', function () {
    expect(findSiteMark('not a url')).toBeNull()
  })
})

describe('findNavigationIconSrc', function () {
  it('扩展 favicon 地址当作图标，不当作字形', function () {
    const icon = 'chrome-extension://cogito/_favicon/?pageUrl=https%3A%2F%2Fgithub.com&size=64'
    expect(findNavigationIconSrc(icon, 'https://github.com')).toBe(icon)
    expect(findNavigationLabel(icon, 'GitHub')).toBe('G')
  })
})
