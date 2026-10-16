import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SHORTCUT_COMMAND } from '@/keyboard/definitions'

/**
 * 全局键管理器的回归测试。
 *
 * 旧的 `features/capture/shortcut.test.ts` 覆盖了三件事：注册/注销顺序、非法组合等于禁用、
 * 并发切换后「最后一个动作必须是注册」。前两条已由 `keyboard/binding.test.ts` 覆盖（校验规则，
 * 与后端无关），第三条是这里必须守住的 —— 历史上并发注销把刚注册的键撤掉过一次。
 */

/** register / unregister 的调用顺序 + 被别的应用占用的组合 */
const mock = vi.hoisted(function () {
  return {
    calls: [] as string[],
    occupied: new Set<string>()
  }
})

vi.mock('@tauri-apps/plugin-global-shortcut', function () {
  return {
    isRegistered: function (shortcut: string) {
      return Promise.resolve(mock.occupied.has(shortcut))
    },
    register: function (shortcut: string) {
      mock.calls.push(`register:${shortcut}`)
      if (mock.occupied.has(shortcut)) return Promise.reject(new Error('occupied'))
      return Promise.resolve()
    },
    unregister: function (shortcut: string) {
      mock.calls.push(`unregister:${shortcut}`)
      return Promise.resolve()
    }
  }
})

/** 每个用例拿一份全新的模块状态（`applied` 与队列都是模块级的） */
async function loadGlobal() {
  vi.resetModules()
  mock.calls.length = 0
  mock.occupied.clear()
  const global = await import('@/keyboard/global')
  const state = await import('@/keyboard/state')
  return {
    applyGlobalShortcuts: global.applyGlobalShortcuts,
    findActiveGlobalBinding: global.findActiveGlobalBinding,
    readGlobalShortcuts: state.readGlobalShortcuts
  }
}

const SCREENSHOT = SHORTCUT_COMMAND.CAPTURE_SCREENSHOT

beforeEach(function () {
  mock.calls.length = 0
  // 「被占用」是这些用例的预期输入，日志不用铺满测试输出
  vi.spyOn(console, 'debug').mockImplementation(function () {})
  vi.spyOn(console, 'warn').mockImplementation(function () {})
})

afterEach(function () {
  mock.occupied.clear()
  vi.restoreAllMocks()
})

describe('applyGlobalShortcuts', function () {
  it('注册成功 → active，且 effective 就是设置里的组合', async function () {
    const { applyGlobalShortcuts, readGlobalShortcuts, findActiveGlobalBinding } =
      await loadGlobal()

    await applyGlobalShortcuts({ [SCREENSHOT]: 'Alt+Q' })

    expect(findActiveGlobalBinding(SCREENSHOT)).toBe('Alt+Q')
    expect(readGlobalShortcuts()[SCREENSHOT]).toMatchObject({
      state: 'active',
      desired: 'Alt+Q',
      effective: 'Alt+Q'
    })
  })

  it('同一个值重复应用只注册一次', async function () {
    const { applyGlobalShortcuts } = await loadGlobal()

    await applyGlobalShortcuts({ [SCREENSHOT]: 'Alt+Q' })
    await applyGlobalShortcuts({ [SCREENSHOT]: 'Alt+Q' })

    expect(mock.calls).toEqual(['register:Alt+Q'])
  })

  it('切换时先注销旧键再注册新键', async function () {
    const { applyGlobalShortcuts, findActiveGlobalBinding } = await loadGlobal()

    await applyGlobalShortcuts({ [SCREENSHOT]: 'Alt+Q' })
    await applyGlobalShortcuts({ [SCREENSHOT]: 'Control+Alt+Q' })

    expect(mock.calls).toEqual(['register:Alt+Q', 'unregister:Alt+Q', 'register:Control+Alt+Q'])
    expect(findActiveGlobalBinding(SCREENSHOT)).toBe('Control+Alt+Q')
  })

  it('并发切换严格排队：最后一个动作必须是注册', async function () {
    const { applyGlobalShortcuts, findActiveGlobalBinding } = await loadGlobal()

    await Promise.all([
      applyGlobalShortcuts({ [SCREENSHOT]: 'Control+Alt+1' }),
      applyGlobalShortcuts({ [SCREENSHOT]: 'Control+Alt+2' })
    ])

    expect(findActiveGlobalBinding(SCREENSHOT)).toBe('Control+Alt+2')
    expect(mock.calls[mock.calls.length - 1]).toBe('register:Control+Alt+2')
  })

  it('设置值不合法 → unavailable，不注册任何键', async function () {
    const { applyGlobalShortcuts, readGlobalShortcuts, findActiveGlobalBinding } =
      await loadGlobal()

    // `mod` 不能用于全局键（OS 注册没有这个别名）
    await applyGlobalShortcuts({ [SCREENSHOT]: 'mod+q' })

    expect(mock.calls).toEqual([])
    expect(findActiveGlobalBinding(SCREENSHOT)).toBeNull()
    expect(readGlobalShortcuts()[SCREENSHOT].state).toBe('unavailable')
  })

  it('想要的组合被占用但有旧值 → 回滚旧值，改动不生效', async function () {
    const { applyGlobalShortcuts, readGlobalShortcuts, findActiveGlobalBinding } =
      await loadGlobal()

    await applyGlobalShortcuts({ [SCREENSHOT]: 'Alt+Q' })
    mock.occupied.add('Control+Alt+Q')

    await applyGlobalShortcuts({ [SCREENSHOT]: 'Control+Alt+Q' })

    const runtime = readGlobalShortcuts()[SCREENSHOT]
    expect(runtime.state).toBe('fallback')
    expect(runtime.desired).toBe('Control+Alt+Q')
    expect(runtime.effective).toBe('Alt+Q')
    expect(runtime.error).toContain('Alt+Q')
    expect(findActiveGlobalBinding(SCREENSHOT)).toBe('Alt+Q')
  })

  it('没有旧值且默认键被占用 → 走备用链，只改运行时', async function () {
    const { applyGlobalShortcuts, readGlobalShortcuts, findActiveGlobalBinding } =
      await loadGlobal()

    mock.occupied.add('Alt+Q')

    await applyGlobalShortcuts({ [SCREENSHOT]: 'Alt+Q' })

    const runtime = readGlobalShortcuts()[SCREENSHOT]
    expect(runtime.state).toBe('fallback')
    // 用户设置里写的仍是 Alt+Q，运行时跑的是备用组合
    expect(runtime.desired).toBe('Alt+Q')
    expect(runtime.effective).toBe('Control+Alt+Q')
    expect(findActiveGlobalBinding(SCREENSHOT)).toBe('Control+Alt+Q')
  })

  it('旧值与备用链全失败 → unavailable 且 effective 为 null，不留假标记', async function () {
    const { applyGlobalShortcuts, readGlobalShortcuts, findActiveGlobalBinding } =
      await loadGlobal()

    await applyGlobalShortcuts({ [SCREENSHOT]: 'Alt+Q' })

    // 旧值（Alt+Q）与备用链全部被占用
    for (const accelerator of ['Alt+Q', 'Control+Alt+Q', 'Alt+Shift+Q', 'Control+Shift+Q']) {
      mock.occupied.add(accelerator)
    }

    await applyGlobalShortcuts({ [SCREENSHOT]: 'Control+Alt+Q' })

    const runtime = readGlobalShortcuts()[SCREENSHOT]
    expect(runtime.state).toBe('unavailable')
    expect(runtime.effective).toBeNull()
    expect(runtime.error).toBeTruthy()
    expect(findActiveGlobalBinding(SCREENSHOT)).toBeNull()
  })
})
