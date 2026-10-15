import { describe, expect, it, vi } from 'vitest'

import { formatShortcut, isValidShortcut } from '@/features/capture/shortcut'

/** register / unregister 的调用顺序，用来断言「最后一个动作是注册」 */
const calls = vi.hoisted(function () {
  return [] as string[]
})

vi.mock('@tauri-apps/plugin-global-shortcut', function () {
  return {
    isRegistered: function () {
      return Promise.resolve(false)
    },
    register: function (shortcut: string) {
      calls.push(`register:${shortcut}`)
      return Promise.resolve()
    },
    unregister: function (shortcut: string) {
      calls.push(`unregister:${shortcut}`)
      return Promise.resolve()
    }
  }
})

/** 每个用例拿一份全新的模块状态（内部的 activeShortcut / 队列是模块级的） */
async function loadShortcut() {
  vi.resetModules()
  calls.length = 0
  return await import('@/features/capture/shortcut')
}

function makeEvent(partial: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    key: partial.key,
    ctrlKey: partial.ctrlKey ?? false,
    altKey: partial.altKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    metaKey: partial.metaKey ?? false
  } as KeyboardEvent
}

describe('formatShortcut', function () {
  it('formats modifier + letter', function () {
    expect(
      formatShortcut(
        makeEvent({
          key: 'a',
          ctrlKey: true,
          shiftKey: true
        })
      )
    ).toBe('Control+Shift+A')
  })

  it('formats Alt+Q', function () {
    expect(
      formatShortcut(
        makeEvent({
          key: 'q',
          altKey: true
        })
      )
    ).toBe('Alt+Q')
  })

  it('returns modifiers only while holding modifier', function () {
    expect(
      formatShortcut(
        makeEvent({
          key: 'Control',
          ctrlKey: true
        })
      )
    ).toBe('Control')
  })
})

describe('isValidShortcut', function () {
  it('accepts modifier + primary', function () {
    expect(isValidShortcut('Alt+Q')).toBe(true)
    expect(isValidShortcut('Control+Shift+A')).toBe(true)
  })

  it('rejects empty or primary-only', function () {
    expect(isValidShortcut('')).toBe(false)
    expect(isValidShortcut('Q')).toBe(false)
    expect(isValidShortcut('Control')).toBe(false)
  })

  it('accepts modifier aliases the plugin understands', function () {
    expect(isValidShortcut('Ctrl+Alt+A')).toBe(true)
    expect(isValidShortcut('CommandOrControl+Shift+1')).toBe(true)
  })
})

describe('bindCaptureShortcut', function () {
  it('同一个值重复绑定只注册一次', async function () {
    const { bindCaptureShortcut } = await loadShortcut()
    await bindCaptureShortcut('Alt+Q')
    await bindCaptureShortcut('Alt+Q')
    expect(calls).toEqual(['register:Alt+Q'])
  })

  it('切换时先注销旧键再注册新键', async function () {
    const { bindCaptureShortcut } = await loadShortcut()
    await bindCaptureShortcut('Alt+Q')
    await bindCaptureShortcut('Control+Shift+A')
    expect(calls).toEqual(['register:Alt+Q', 'unregister:Alt+Q', 'register:Control+Shift+A'])
  })

  it('非法组合只注销、不注册（等于禁用）', async function () {
    const { bindCaptureShortcut } = await loadShortcut()
    await bindCaptureShortcut('Alt+Q')
    await bindCaptureShortcut('Q')
    expect(calls).toEqual(['register:Alt+Q', 'unregister:Alt+Q'])
  })

  it('并发切换严格排队：最后一个动作必须是注册（回归：曾被注销掉 → 按了没反应）', async function () {
    const { bindCaptureShortcut, findActiveShortcut } = await loadShortcut()
    await Promise.all([bindCaptureShortcut('Control+Alt+1'), bindCaptureShortcut('Control+Alt+2')])
    expect(findActiveShortcut()).toBe('Control+Alt+2')
    expect(calls[calls.length - 1]).toBe('register:Control+Alt+2')
  })
})
