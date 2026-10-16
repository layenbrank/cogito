import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  findCommand,
  findCommands,
  readAllCommands,
  registerCommands,
  registerHandler,
  runCommand,
  subscribeCommands
} from '@/keyboard/commands'
import type { CommandHandler } from '@/keyboard/commands'
import type { Command } from '@/keyboard/types'

/**
 * 元数据与处理器都是模块级单例：本文件所有注册都进 `disposers`，每个用例结束统一注销，
 * 否则泄漏的处理器会抢走后面用例的同一个 id（与 `keycodes/dispatcher.test.ts` 同一套做法）。
 * 注销是幂等的，所以用例中途手动注销过的也会在 `afterEach` 里再跑一次，无副作用。
 */
const disposers: Array<() => void> = []

function track(dispose: () => void): () => void {
  disposers.push(dispose)
  return dispose
}

function register(commands: readonly Command[]): () => void {
  return track(registerCommands(commands))
}

function handle(
  id: string,
  handler: CommandHandler,
  options?: { priority?: number; enabled?: () => boolean }
): () => void {
  return track(registerHandler(id, handler, options))
}

function command(id: string, run: Command['run'] = function () {}, extra?: Partial<Command>) {
  return { id, title: id, ...extra, run } satisfies Command
}

afterEach(function () {
  while (disposers.length > 0) disposers.pop()?.()
})

describe('command registry', function () {
  it('没有注册时执行返回 false', async function () {
    await expect(runCommand('nothing.here')).resolves.toBe(false)
  })

  it('注册后执行 run 并返回 true', async function () {
    const run = vi.fn()
    register([command('app.demo', run)])

    await expect(runCommand('app.demo')).resolves.toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('元数据可被枚举与检索', function () {
    register([
      command('file.save', function () {}, { title: '文件: 保存', keywords: 'save' }),
      command('view.sidebar', function () {}, { title: '查看: 侧栏' })
    ])

    expect(findCommand('file.save')?.title).toBe('文件: 保存')
    expect(findCommands('保存').map(function (item) {
      return item.id
    })).toEqual(['file.save'])
    expect(findCommands('sidebar').map(function (item) {
      return item.id
    })).toEqual(['view.sidebar'])
    expect(findCommands('').length).toBeGreaterThanOrEqual(2)
  })

  it('when 为 false 的命令不出现也不执行', async function () {
    const run = vi.fn()
    register([command('view.only', run, { when: function () { return false } })])

    expect(findCommands('view.only')).toHaveLength(0)
    await expect(runCommand('view.only')).resolves.toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('组件接管优先于命令兜底', async function () {
    const run = vi.fn()
    const claimed = vi.fn(function () {
      return true
    })
    register([command('capture.screenshot', run)])
    handle('capture.screenshot', claimed)

    await expect(runCommand('capture.screenshot')).resolves.toBe(true)
    expect(claimed).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
  })

  it('没人接管时落到命令兜底', async function () {
    const run = vi.fn()
    register([command('capture.fallback', run)])
    handle('capture.fallback', function () {
      return false
    })

    await expect(runCommand('capture.fallback')).resolves.toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('同优先级时后注册者优先', async function () {
    const calls: string[] = []
    register([command('app.order')])
    handle('app.order', function () {
      calls.push('first')
      return true
    })
    handle('app.order', function () {
      calls.push('second')
      return true
    })

    await runCommand('app.order')
    expect(calls).toEqual(['second'])
  })

  it('优先级高的先执行', async function () {
    const calls: string[] = []
    register([command('app.priority')])
    handle('app.priority', function () {
      calls.push('low')
      return true
    })
    handle(
      'app.priority',
      function () {
        calls.push('high')
        return true
      },
      { priority: 10 }
    )

    await runCommand('app.priority')
    expect(calls).toEqual(['high'])
  })

  it('enabled 为 false 的处理器被跳过并落到兜底', async function () {
    const run = vi.fn()
    register([command('app.enabled', run)])
    handle(
      'app.enabled',
      function () {
        return true
      },
      {
        priority: 10,
        enabled: function () {
          return false
        }
      }
    )

    await expect(runCommand('app.enabled')).resolves.toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('处理器抛错不影响后续', async function () {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(function () {})
    const run = vi.fn()
    register([command('app.throwing', run)])
    handle(
      'app.throwing',
      function () {
        throw new Error('boom')
      },
      { priority: 10 }
    )

    await expect(runCommand('app.throwing')).resolves.toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })

  it('注销后既查不到也执行不了', async function () {
    const dispose = register([command('app.gone', vi.fn())])

    dispose()

    expect(findCommand('app.gone')).toBeUndefined()
    await expect(runCommand('app.gone')).resolves.toBe(false)
  })

  it('同名命令重新注册后跑最新实现', async function () {
    const stale = vi.fn()
    const fresh = vi.fn()
    register([command('app.replaced', stale)])
    register([command('app.replaced', fresh)])

    await runCommand('app.replaced')
    expect(fresh).toHaveBeenCalledTimes(1)
    expect(stale).not.toHaveBeenCalled()
  })

  it('注销旧注册不会摘掉新注册的元数据', function () {
    const first = register([command('app.stale', function () {}, { title: '旧' })])
    register([command('app.stale', function () {}, { title: '新' })])

    first()

    expect(findCommand('app.stale')?.title).toBe('新')
  })

  it('元数据未变化时快照引用保持稳定', function () {
    register([command('app.snapshot')])
    const before = readAllCommands()

    expect(readAllCommands()).toBe(before)
  })

  it('注册与注销会通知订阅者', function () {
    const listener = vi.fn()
    const unsubscribe = subscribeCommands(listener)

    const dispose = register([command('app.notify')])
    const afterRegister = listener.mock.calls.length
    expect(afterRegister).toBeGreaterThan(0)

    dispose()
    expect(listener.mock.calls.length).toBeGreaterThan(afterRegister)

    unsubscribe()
  })
})
