import { describe, expect, it } from 'vitest'

import { findShowsShellBack } from '@/views/settings/shell'

describe('findShowsShellBack', function () {
  it('主窗有会话条时不显示侧栏返回', function () {
    expect(findShowsShellBack(true, 'main')).toBe(false)
  })

  it('独立设置磁贴窗不显示侧栏返回', function () {
    expect(findShowsShellBack(false, 'settings:abc')).toBe(false)
  })

  it('其它窗同窗切入设置时显示返回', function () {
    expect(findShowsShellBack(false, 'agent:abc')).toBe(true)
    expect(findShowsShellBack(false, '')).toBe(true)
  })
})
