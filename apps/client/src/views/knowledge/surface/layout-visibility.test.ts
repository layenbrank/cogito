import { describe, expect, it } from 'vitest'

import { findLayoutVisibility, findRightPaneMode } from '@/views/knowledge/surface/layout-visibility.ts'

describe('findLayoutVisibility', function () {
  it('编辑器优先：wiki 页只显示编辑器，侧栏始终在', function () {
    const visibility = findLayoutVisibility('wiki')
    expect(visibility.showLeftContent).toBe(true)
    expect(visibility.showEditor).toBe(true)
    expect(visibility.showToolMain).toBe(false)
  })

  it('工具页占主区，侧栏不收起', function () {
    for (const tab of ['sources', 'search', 'graph', 'lint', 'review', 'staging'] as const) {
      const visibility = findLayoutVisibility(tab)
      expect(visibility.showToolMain).toBe(true)
      expect(visibility.showEditor).toBe(false)
      expect(visibility.showLeftContent).toBe(true)
    }
  })

  it('设置也是普通工具页：不再有 rail-only 形态', function () {
    const visibility = findLayoutVisibility('settings')
    expect(visibility.showToolMain).toBe(true)
    expect(visibility.showLeftContent).toBe(true)
    expect(visibility).not.toHaveProperty('isRailOnly')
  })
})

describe('findRightPaneMode', function () {
  const space = { isAsideOpen: true, isFocusMode: false }

  it('大纲只在 wiki 主区展开', function () {
    expect(
      findRightPaneMode({ ...space, tab: 'wiki', asideTab: 'outline' })
    ).toBe('aside')
    expect(
      findRightPaneMode({ ...space, tab: 'search', asideTab: 'outline' })
    ).toBe('hidden')
  })

  it('深度研究可与工具主区并存', function () {
    expect(
      findRightPaneMode({ ...space, tab: 'search', asideTab: 'research' })
    ).toBe('aside')
  })

  it('专注模式与设置页不展开抽屉', function () {
    expect(
      findRightPaneMode({ tab: 'wiki', asideTab: 'outline', isAsideOpen: true, isFocusMode: true })
    ).toBe('hidden')
    expect(
      findRightPaneMode({ ...space, tab: 'settings', asideTab: 'research' })
    ).toBe('hidden')
  })

  it('抽屉关闭时不展开', function () {
    expect(
      findRightPaneMode({
        tab: 'wiki',
        asideTab: 'outline',
        isAsideOpen: false,
        isFocusMode: false
      })
    ).toBe('hidden')
  })
})
