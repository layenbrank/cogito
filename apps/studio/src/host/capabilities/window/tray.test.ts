import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Context } from '@/host/framework/context'
import type { Plugin } from '@/host/framework/module'
import { buildPlugin, type TrayDeps } from './tray'

/**
 * 托盘是纯胶水，风险全在「菜单点了到底调没调到那个端口」——
 * 这里把 electron 与图标解析换成假实现，只验这条接线，以及「拿不到图标就不建」这条退路。
 */

const state = vi.hoisted(function () {
  return {
    tooltips: [] as string[],
    templates: [] as Array<Array<Record<string, unknown>>>,
    created: 0,
    destroyed: 0,
    quitCount: 0,
    clickHandlers: [] as Array<() => void>,
    iconPath: '/fake/icon.png' as string | undefined
  }
})

vi.mock('electron', function () {
  class FakeTray {
    constructor() {
      state.created += 1
    }

    setToolTip(text: string) {
      state.tooltips.push(text)
    }

    setContextMenu(menu: unknown) {
      void menu
    }

    on(event: string, handler: () => void) {
      if (event === 'click') state.clickHandlers.push(handler)
    }

    destroy() {
      state.destroyed += 1
    }
  }

  return {
    app: {
      getName: function () {
        return 'cogito'
      },
      quit: function () {
        state.quitCount += 1
      }
    },
    nativeImage: {
      createFromPath: function (value: string) {
        return {
          path: value,
          resize: function () {
            return { resized: true }
          }
        }
      }
    },
    Menu: {
      buildFromTemplate: function (template: Array<Record<string, unknown>>) {
        state.templates.push(template)
        return { template }
      }
    },
    Tray: FakeTray
  }
})

// 图标解析走的是真实文件系统，这里只关心「有 / 没有」两条分支
vi.mock('./factory', function () {
  return {
    findAppIconPath: function () {
      return state.iconPath
    }
  }
})

function makeContext() {
  return {
    logger: {
      child: function () {
        return { info: function () {}, warn: function () {} }
      }
    }
  } as unknown as Context
}

function makeDeps() {
  const calls = { reveal: 0, openAgent: 0 }
  return {
    calls,
    deps: {
      mainWindow: {
        toRead: function () {
          return null
        },
        toReveal: function () {
          calls.reveal += 1
        }
      },
      agentWindow: {
        toOpen: function () {
          calls.openAgent += 1
        }
      }
    } satisfies TrayDeps
  }
}

/** `register` 的签名是 `void | Promise<void>`，而这里只验调用之后的可观测结果 */
function registerTray(deps: TrayDeps): Plugin {
  const plugin = buildPlugin(deps)
  void plugin.register(makeContext())
  return plugin
}

beforeEach(function () {
  state.tooltips = []
  state.templates = []
  state.created = 0
  state.destroyed = 0
  state.quitCount = 0
  state.clickHandlers = []
  state.iconPath = '/fake/icon.png'
})

afterEach(function () {
  vi.restoreAllMocks()
})

describe('tray plugin', function () {
  it('creates the tray with a tooltip and a menu', function () {
    const { deps } = makeDeps()

    registerTray(deps)

    expect(state.created).toBe(1)
    expect(state.tooltips).toEqual(['cogito'])
    expect(state.templates).toHaveLength(1)
  })

  it('wires the three menu entries to the ports', function () {
    const { deps, calls } = makeDeps()
    registerTray(deps)

    const template = state.templates[0]
    const labels = template.map(function (item) {
      return item.label ?? item.type
    })
    expect(labels).toEqual(['打开主窗口', '打开 Agent 窗口', 'separator', '退出 cogito'])

    ;(template[0].click as () => void)()
    ;(template[1].click as () => void)()
    ;(template[3].click as () => void)()

    expect(calls.reveal).toBe(1)
    expect(calls.openAgent).toBe(1)
    expect(state.quitCount).toBe(1)
  })

  it('reveals the main window on tray click (non-macOS)', function () {
    const { deps, calls } = makeDeps()
    registerTray(deps)

    expect(state.clickHandlers).toHaveLength(1)
    state.clickHandlers[0]()

    expect(calls.reveal).toBe(1)
  })

  it('skips the tray when the icon is missing', function () {
    state.iconPath = undefined
    const { deps } = makeDeps()

    expect(function () {
      registerTray(deps)
    }).not.toThrow()

    expect(state.created).toBe(0)
    expect(state.templates).toEqual([])
  })

  it('destroys the tray on dispose', function () {
    const { deps } = makeDeps()
    const plugin = registerTray(deps)

    void plugin.dispose?.()

    expect(state.destroyed).toBe(1)
  })

  it('dispose without a tray is a no-op', function () {
    const { deps } = makeDeps()
    const plugin = buildPlugin(deps)

    expect(function () {
      void plugin.dispose?.()
    }).not.toThrow()
    expect(state.destroyed).toBe(0)
  })
})
