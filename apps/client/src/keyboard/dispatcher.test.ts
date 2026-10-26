import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { registerCommands } from '@/keyboard/commands'
import { SHORTCUT_COMMAND } from '@/keyboard/definitions'
import { dispatchKeydown } from '@/keyboard/dispatcher'
import type { Command } from '@/keyboard/types'

const disposers: Array<() => void> = []

function event(init: KeyboardEventInit): KeyboardEvent {
  // 必须 cancelable：否则 synthetic event 上的 preventDefault 是空操作，断言不出东西
  return new KeyboardEvent('keydown', { cancelable: true, ...init })
}

/** 截屏浮层的退出命令（`overlay.escape` 的兜底实现） */
let runEscape: Mock<() => void>

beforeEach(function () {
  runEscape = vi.fn()
  disposers.push(
    registerCommands([
      {
        id: SHORTCUT_COMMAND.OVERLAY_ESCAPE,
        title: '截屏：退出',
        run: runEscape
      } satisfies Command
    ])
  )
})

afterEach(function () {
  while (disposers.length > 0) disposers.pop()?.()
  document.body.innerHTML = ''
})

describe('dispatchKeydown', function () {
  it('命中已注册的命令并拦掉默认行为', async function () {
    const pressed = event({ key: 'Escape', code: 'Escape' })

    await expect(dispatchKeydown(pressed, 'overlay')).resolves.toBe(true)
    expect(runEscape).toHaveBeenCalledTimes(1)
    expect(pressed.defaultPrevented).toBe(true)
  })

  it('窗口不匹配时不派发', async function () {
    await expect(dispatchKeydown(event({ key: 'Escape', code: 'Escape' }), 'main')).resolves.toBe(
      false
    )
    expect(runEscape).not.toHaveBeenCalled()
  })

  it('没人注册处理器时不认这一键（不抢没人管的组合）', async function () {
    disposers.pop()?.()
    const pressed = event({ key: 'Escape', code: 'Escape' })

    await expect(dispatchKeydown(pressed, 'overlay')).resolves.toBe(false)
    expect(pressed.defaultPrevented).toBe(false)
  })

  it('输入框里不派发（该键位没开 allowInFormTags）', async function () {
    const input = document.createElement('input')
    document.body.appendChild(input)
    const pressed = event({ key: 'Escape', code: 'Escape' })
    input.dispatchEvent(pressed)

    await expect(dispatchKeydown(pressed, 'overlay')).resolves.toBe(false)
    expect(runEscape).not.toHaveBeenCalled()
  })

  it('已 preventDefault 的事件被忽略', async function () {
    const pressed = event({ key: 'Escape', code: 'Escape' })
    pressed.preventDefault()

    await expect(dispatchKeydown(pressed, 'overlay')).resolves.toBe(false)
    expect(runEscape).not.toHaveBeenCalled()
  })

  it('只按修饰键不派发', async function () {
    await expect(
      dispatchKeydown(event({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), 'overlay')
    ).resolves.toBe(false)
    expect(runEscape).not.toHaveBeenCalled()
  })

  /**
   * 硬约束：全局键由 OS 注册、由 `keyboard/global.ts` 回调派发。
   * 若 DOM 也认，前台按下会双触发 —— 这条断言就是防它。
   */
  it('全局键（capture.screenshot）永不进 DOM 派发器', async function () {
    const runScreenshot = vi.fn()
    disposers.push(
      registerCommands([
        {
          id: SHORTCUT_COMMAND.CAPTURE_SCREENSHOT,
          title: '截屏',
          run: runScreenshot
        } satisfies Command
      ])
    )

    const pressed = event({ key: 'q', code: 'KeyQ', altKey: true })
    await expect(dispatchKeydown(pressed, 'main')).resolves.toBe(false)
    await expect(dispatchKeydown(pressed, 'overlay')).resolves.toBe(false)

    expect(runScreenshot).not.toHaveBeenCalled()
    expect(pressed.defaultPrevented).toBe(false)
  })

  it('非 Tauri 环境读不到窗口 label 时不过滤窗口', async function () {
    // jsdom 没有 `__TAURI_INTERNALS__`，`findWindowLabel()` 返回 null
    await expect(dispatchKeydown(event({ key: 'Escape', code: 'Escape' }))).resolves.toBe(true)
    expect(runEscape).toHaveBeenCalledTimes(1)
  })
})

describe('dispatchKeydown · 视图级键位', function () {
  /** code 窗的保存（`mod+s`，window: 'main'，allowInFormTags） */
  function registerCodeSave(run: () => void): void {
    disposers.push(
      registerCommands([
        { id: SHORTCUT_COMMAND.CODE_SAVE, title: '代码窗：保存', run } satisfies Command
      ])
    )
  }

  function ctrlS(): KeyboardEvent {
    return event({ key: 's', code: 'KeyS', ctrlKey: true })
  }

  it('只在主窗派发', async function () {
    const run = vi.fn()
    registerCodeSave(run)

    await expect(dispatchKeydown(ctrlS(), 'main')).resolves.toBe(true)
    expect(run).toHaveBeenCalledTimes(1)

    await expect(dispatchKeydown(ctrlS(), 'overlay')).resolves.toBe(false)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('编辑器（textarea）里也生效 —— 否则保存键会落到浏览器默认行为上', async function () {
    const run = vi.fn()
    registerCodeSave(run)

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    const pressed = ctrlS()
    textarea.dispatchEvent(pressed)

    await expect(dispatchKeydown(pressed, 'main')).resolves.toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('两个视图声明同一组合时只执行一个（路由互斥，不该双执行）', async function () {
    const runCode = vi.fn()
    const runMarkdown = vi.fn()
    registerCodeSave(runCode)
    disposers.push(
      registerCommands([
        { id: SHORTCUT_COMMAND.KNOWLEDGE_SAVE, title: '笔记窗：保存', run: runMarkdown } satisfies Command
      ])
    )

    await expect(dispatchKeydown(ctrlS(), 'main')).resolves.toBe(true)
    expect(runCode.mock.calls.length + runMarkdown.mock.calls.length).toBe(1)
  })
})
