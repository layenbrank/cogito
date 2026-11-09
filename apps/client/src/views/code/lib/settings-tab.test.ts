import { beforeEach, describe, expect, it } from 'vitest'

import { SETTINGS_TAB_PATH, useCodeStore } from '@/stores/code'

describe('toOpenSettingsTab', function () {
  beforeEach(function () {
    useCodeStore.setState({ tabs: [], activeTabId: null })
  })

  it('首次打开新增设置标签并激活', function () {
    useCodeStore.getState().toOpenSettingsTab()
    const state = useCodeStore.getState()
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]?.kind).toBe('settings')
    expect(state.tabs[0]?.path).toBe(SETTINGS_TAB_PATH)
    expect(state.activeTabId).toBe(state.tabs[0]?.id)
  })

  it('重复打开只激活，不重复建标签', function () {
    useCodeStore.getState().toOpenSettingsTab()
    const firstID = useCodeStore.getState().tabs[0]?.id
    useCodeStore.setState({ activeTabId: null })
    useCodeStore.getState().toOpenSettingsTab()
    const state = useCodeStore.getState()
    expect(state.tabs).toHaveLength(1)
    expect(state.activeTabId).toBe(firstID)
  })
})
