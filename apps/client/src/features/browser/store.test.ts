import { beforeEach, describe, expect, it, vi } from 'vitest'

// store 在模块顶层就订阅 Rust 广播，测试里必须把 Tauri 的 IPC 挡掉
vi.mock('@tauri-apps/api/core', function () {
  return { invoke: vi.fn(async function () { return null }) }
})
vi.mock('@tauri-apps/api/event', function () {
  return { listen: vi.fn(async function () { return function () {} }) }
})

import type { DeviceProfile } from './device'
import { useBrowserStore } from './store'

const IPHONE: DeviceProfile = {
  width: 393,
  height: 852,
  dpr: 3,
  mobile: true,
  userAgent: 'Mozilla/5.0 (iPhone)'
}

function reset() {
  useBrowserStore.setState({ tabs: [], activeLabel: null, deviceByLabel: {} })
}

beforeEach(reset)

describe('adoptSnapshot', function () {
  it('设备状态跟着快照回灌', function () {
    useBrowserStore.getState().adoptSnapshot({
      tabs: [
        { label: 'browser-a', url: 'https://a.test', title: 'A', device: IPHONE },
        { label: 'browser-b', url: 'https://b.test', title: '', device: null }
      ],
      active: 'browser-a'
    })

    const state = useBrowserStore.getState()
    expect(state.activeLabel).toBe('browser-a')
    expect(state.tabs[0].title).toBe('A')
    expect(state.deviceByLabel['browser-a']).toEqual(IPHONE)
    // null 也要有键：否则 UI 分不清「桌面」与「还没回过灌」
    expect(state.deviceByLabel['browser-b']).toBeNull()
  })

  it('第二次快照会清掉已关闭 tab 的设备记录', function () {
    useBrowserStore.getState().adoptSnapshot({
      tabs: [{ label: 'browser-a', url: 'https://a.test', title: 'A', device: IPHONE }],
      active: 'browser-a'
    })
    expect(useBrowserStore.getState().deviceByLabel['browser-a']).toEqual(IPHONE)

    useBrowserStore.getState().adoptSnapshot({ tabs: [], active: null })
    expect(useBrowserStore.getState().deviceByLabel).toEqual({})
  })

  it('旧快照缺 device 字段时按桌面处理', function () {
    // 兼容「Rust 是旧版本 / 字段被省掉」的情形
    useBrowserStore.getState().adoptSnapshot({
      tabs: [{ label: 'browser-a', url: 'https://a.test' } as never],
      active: 'browser-a'
    })
    expect(useBrowserStore.getState().deviceByLabel['browser-a']).toBeNull()
  })
})

describe('setDevice', function () {
  it('只改本地的设备表，不动 tabs', function () {
    useBrowserStore.getState().adoptSnapshot({
      tabs: [{ label: 'browser-a', url: 'https://a.test', title: '', device: null }],
      active: 'browser-a'
    })
    useBrowserStore.getState().setDevice('browser-a', IPHONE)

    const state = useBrowserStore.getState()
    expect(state.deviceByLabel['browser-a']).toEqual(IPHONE)
    expect(state.tabs[0].device).toBeNull()

    useBrowserStore.getState().setDevice('browser-a', null)
    expect(useBrowserStore.getState().deviceByLabel['browser-a']).toBeNull()
  })
})

describe('closeTab', function () {
  it('关掉的 tab 不再留在设备表里', async function () {
    useBrowserStore.getState().adoptSnapshot({
      tabs: [
        { label: 'browser-a', url: 'https://a.test', title: 'A', device: IPHONE },
        { label: 'browser-b', url: 'https://b.test', title: 'B', device: null }
      ],
      active: 'browser-a'
    })

    await useBrowserStore.getState().closeTab('browser-a')

    const state = useBrowserStore.getState()
    expect(Object.keys(state.deviceByLabel)).toEqual(['browser-b'])
    expect(state.activeLabel).toBe('browser-b')
  })
})
