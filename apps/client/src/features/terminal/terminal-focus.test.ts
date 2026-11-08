/**
 * 聚焦门槛的行为断言。
 *
 * 「agent 跑命令把 composer 的焦点抢走」这类 bug 只有在真人打字时才看得出来，
 * 所以把判定抽成纯函数钉死：宁可少聚焦，不可抢用户正在写的字。
 */
import { describe, expect, it, vi } from 'vitest'

import { canTakeFocus, isEditableElement } from './terminal-focus'

function mounted(...classes: string[]): HTMLDivElement {
  const element = document.createElement('div')
  if (classes.length > 0) element.className = classes.join(' ')
  document.body.append(element)
  return element
}

function make(tag: 'input' | 'textarea' | 'div'): HTMLElement {
  const element = document.createElement(tag)
  document.body.append(element)
  return element
}

describe('isEditableElement', function () {
  it('输入类元素算可编辑', function () {
    expect(isEditableElement(make('input'))).toBe(true)
    expect(isEditableElement(make('textarea'))).toBe(true)
  })

  it('contentEditable 算可编辑', function () {
    const editor = make('div')
    editor.setAttribute('contenteditable', 'true')
    // jsdom 不实现 isContentEditable，这里直接打桩验证判定分支
    Object.defineProperty(editor, 'isContentEditable', { value: true })
    expect(isEditableElement(editor)).toBe(true)
  })

  it('xterm 容器内的元素算可编辑（另一个终端里有光标）', function () {
    const xterm = mounted('xterm')
    const inner = document.createElement('textarea')
    xterm.append(inner)
    expect(isEditableElement(inner)).toBe(true)
  })

  it('普通 div / body 不算可编辑', function () {
    expect(isEditableElement(make('div'))).toBe(false)
    expect(isEditableElement(document.body)).toBe(false)
    expect(isEditableElement(null)).toBe(false)
  })
})

describe('canTakeFocus', function () {
  it('容器未挂载 / 窗口在后台：不聚焦', function () {
    const detached = document.createElement('div')
    expect(canTakeFocus(detached)).toBe(false)
    expect(canTakeFocus(mounted(), { focused: false, active: null })).toBe(false)
  })

  it('焦点在 body（没人打字）：可以聚焦', function () {
    expect(canTakeFocus(mounted(), { focused: true, active: document.body })).toBe(true)
    expect(canTakeFocus(mounted(), { focused: true, active: null })).toBe(true)
  })

  it('焦点已经在这个终端里：可以聚焦（幂等）', function () {
    const container = mounted()
    const inner = document.createElement('div')
    container.append(inner)
    expect(canTakeFocus(container, { focused: true, active: inner })).toBe(true)
  })

  it('焦点在输入框：不许抢（这正是 composer 被抢的场景）', function () {
    const input = make('textarea')
    expect(canTakeFocus(mounted(), { focused: true, active: input })).toBe(false)
  })

  it('焦点在别的 xterm：不许抢', function () {
    const other = mounted('xterm')
    const inner = document.createElement('div')
    other.append(inner)
    expect(canTakeFocus(mounted(), { focused: true, active: inner })).toBe(false)
  })

  it('焦点在普通按钮上：可以聚焦（用户刚点过别处）', function () {
    const button = document.createElement('button')
    document.body.append(button)
    expect(canTakeFocus(mounted(), { focused: true, active: button })).toBe(true)
  })

  it('默认读 document：jsdom 下不抛错', function () {
    const spy = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    expect(function () {
      canTakeFocus(mounted())
    }).not.toThrow()
    spy.mockRestore()
  })
})
