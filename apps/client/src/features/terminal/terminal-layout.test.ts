/**
 * xterm 布局同步的断言。
 *
 * 这里是「终端空白 / 只有光标」的直接现场：`fit` 量到 0 列、或者尺寸没变就以为
 * 不需要 resize（ConPTY 下正是这一条导致晚 attach 只剩光标）。所以用例盯着
 * `fit / resize / refresh / focus` 的实际调用，以及 observer 是「撑住等尺寸」还是「提前放弃」。
 *
 * jsdom 没有 ResizeObserver，也没有真实的布局尺寸：容器宽度用 defineProperty 造，
 * rAF 换成手动队列，ResizeObserver 换成可手动触发的假实现。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal as XtermTerminal } from '@xterm/xterm'

import { hasTerminalLayoutSize, scheduleTerminalLayout, syncTerminalLayout } from './terminal-layout'

interface FakeTerminal {
  cols: number
  rows: number
  resize: Mock<(cols: number, rows: number) => void>
  refresh: Mock<(start: number, end: number) => void>
  focus: Mock<() => void>
}

interface FakeFit {
  fit: Mock<() => void>
}

let frameQueue: FrameRequestCallback[] = []
let observers: FakeResizeObserver[] = []

class FakeResizeObserver {
  callback: ResizeObserverCallback
  targets: Element[] = []
  disconnected = false

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    observers.push(this)
  }

  observe(target: Element): void {
    this.targets.push(target)
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true
  }

  trigger(): void {
    if (this.disconnected) return
    this.callback([], this)
  }
}

/** 冲掉 rAF 队列；`depth` 对应 `requestAnimationFrame(() => requestAnimationFrame(fn))` */
function flushFrames(depth = 2): void {
  for (let index = 0; index < depth; index += 1) {
    const batch = frameQueue
    frameQueue = []
    for (const callback of batch) callback(0)
  }
}

function makeContainer(width: number, height: number): HTMLElement {
  const element = document.createElement('div')
  setSize(element, width, height)
  document.body.appendChild(element)
  return element
}

function setSize(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height })
}

function makeTerminal(cols = 80, rows = 24): FakeTerminal {
  const terminal: FakeTerminal = {
    cols,
    rows,
    resize: vi.fn(function (nextCols: number, nextRows: number) {
      terminal.cols = nextCols
      terminal.rows = nextRows
    }),
    refresh: vi.fn(),
    focus: vi.fn()
  }
  return terminal
}

/** fit 的副作用由用例决定：给尺寸就是「量到了」，不给就是「量完还是原样」 */
function makeFit(terminal: FakeTerminal, measured?: { cols: number; rows: number }): FakeFit {
  return {
    fit: vi.fn(function () {
      if (!measured) return
      terminal.cols = measured.cols
      terminal.rows = measured.rows
    })
  }
}

function asXterm(terminal: FakeTerminal): XtermTerminal {
  return terminal as unknown as XtermTerminal
}

function asFit(fit: FakeFit): FitAddon {
  return fit as unknown as FitAddon
}

beforeEach(function () {
  frameQueue = []
  observers = []
  vi.stubGlobal('requestAnimationFrame', function (callback: FrameRequestCallback) {
    frameQueue.push(callback)
    return frameQueue.length
  })
  vi.stubGlobal('cancelAnimationFrame', function () {})
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(function () {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('hasTerminalLayoutSize', function () {
  it('容器不存在 → false', function () {
    expect(hasTerminalLayoutSize(null)).toBe(false)
  })

  it('0×0（面板还没显示）→ false', function () {
    expect(hasTerminalLayoutSize(makeContainer(0, 0))).toBe(false)
  })

  it('只有 1px 也算没有布局 → false（fit 会量到 <2 列）', function () {
    expect(hasTerminalLayoutSize(makeContainer(1, 40))).toBe(false)
    expect(hasTerminalLayoutSize(makeContainer(40, 1))).toBe(false)
  })

  it('2×2 起算有布局', function () {
    expect(hasTerminalLayoutSize(makeContainer(2, 2))).toBe(true)
  })
})

describe('syncTerminalLayout', function () {
  it('terminal / fit 缺失时不动作', function () {
    const container = makeContainer(400, 200)
    expect(syncTerminalLayout(null, asFit(makeFit(makeTerminal())), container, true)).toBe(false)
    expect(syncTerminalLayout(asXterm(makeTerminal()), null, container, true)).toBe(false)
  })

  it('容器无尺寸时直接返回 false，连 fit 都不调', function () {
    const terminal = makeTerminal()
    const fit = makeFit(terminal, { cols: 100, rows: 30 })
    const container = makeContainer(0, 0)

    expect(syncTerminalLayout(asXterm(terminal), asFit(fit), container, true)).toBe(false)
    expect(fit.fit).not.toHaveBeenCalled()
    expect(terminal.resize).not.toHaveBeenCalled()
  })

  it('fit 量到新尺寸：只 refresh，不额外 resize', function () {
    const terminal = makeTerminal()
    const fit = makeFit(terminal, { cols: 100, rows: 30 })
    const container = makeContainer(800, 400)

    expect(syncTerminalLayout(asXterm(terminal), asFit(fit), container, false)).toBe(true)
    expect(fit.fit).toHaveBeenCalledTimes(1)
    expect(terminal.cols).toBe(100)
    expect(terminal.resize).not.toHaveBeenCalled()
    expect(terminal.refresh).toHaveBeenCalledWith(0, 29)
    expect(terminal.focus).not.toHaveBeenCalled()
  })

  it('尺寸没变也强制 resize 一次（ConPTY 晚 attach 否则只剩光标）', function () {
    const terminal = makeTerminal(80, 24)
    const fit = makeFit(terminal)
    const container = makeContainer(800, 400)

    expect(syncTerminalLayout(asXterm(terminal), asFit(fit), container, true)).toBe(true)
    expect(fit.fit).toHaveBeenCalledTimes(1)
    expect(terminal.resize).toHaveBeenCalledWith(80, 24)
    // resize 会再触发一次 refresh（0..rows-1）
    expect(terminal.refresh).toHaveBeenCalledWith(0, 23)
    expect(terminal.focus).toHaveBeenCalledTimes(1)
  })

  it('fit 之后仍然是 0/1 列视为失败，交给 ResizeObserver 重试', function () {
    const terminal = makeTerminal()
    const fit = makeFit(terminal, { cols: 1, rows: 24 })
    const container = makeContainer(800, 400)

    expect(syncTerminalLayout(asXterm(terminal), asFit(fit), container, false)).toBe(false)
    expect(terminal.resize).not.toHaveBeenCalled()
    expect(terminal.refresh).not.toHaveBeenCalled()
  })

  it('fit 抛错不冒泡（xterm 未就绪时只是没布局）', function () {
    const container = makeContainer(800, 400)
    const terminal = makeTerminal()
    const fit: FakeFit = {
      fit: vi.fn(function () {
        throw new Error('xterm 未 open')
      })
    }
    const debug = vi.spyOn(console, 'debug').mockImplementation(function () {})

    expect(syncTerminalLayout(asXterm(terminal), asFit(fit), container, true)).toBe(false)
    expect(debug).toHaveBeenCalled()
  })
})

describe('scheduleTerminalLayout', function () {
  it('容器缺失时什么都不安排', function () {
    scheduleTerminalLayout(asXterm(makeTerminal()), asFit(makeFit(makeTerminal())), null, false, function () {
      return false
    })
    expect(observers).toHaveLength(0)
    expect(frameQueue).toHaveLength(0)
  })

  it('尺寸就绪：双 rAF 后 fit 成功并立刻断开 observer（不留轮询）', function () {
    const terminal = makeTerminal()
    const fit = makeFit(terminal, { cols: 120, rows: 40 })
    const container = makeContainer(900, 500)

    scheduleTerminalLayout(asXterm(terminal), asFit(fit), container, false, function () {
      return false
    })
    expect(observers).toHaveLength(1)
    expect(fit.fit).not.toHaveBeenCalled()

    flushFrames()

    expect(fit.fit).toHaveBeenCalledTimes(1)
    expect(observers[0]?.disconnected).toBe(true)
    expect(terminal.refresh).toHaveBeenCalledWith(0, 39)
  })

  it('尺寸为 0 时保持 pending，等 ResizeObserver 再来一次（不放弃）', function () {
    const terminal = makeTerminal()
    const fit = makeFit(terminal, { cols: 120, rows: 40 })
    const container = makeContainer(0, 0)

    scheduleTerminalLayout(asXterm(terminal), asFit(fit), container, false, function () {
      return false
    })

    // 首屏假窄冻结期：60 帧也等不到尺寸，但这里不能放弃
    for (let index = 0; index < 60; index += 1) flushFrames(1)
    expect(fit.fit).not.toHaveBeenCalled()
    expect(observers[0]?.disconnected).toBe(false)

    // 面板终于展开
    setSize(container, 900, 500)
    observers[0]?.trigger()

    expect(fit.fit).toHaveBeenCalledTimes(1)
    expect(observers[0]?.disconnected).toBe(true)
  })

  it('视图已卸载（isCancelled）：回收 observer，不再 fit', function () {
    const terminal = makeTerminal()
    const fit = makeFit(terminal, { cols: 120, rows: 40 })
    const container = makeContainer(900, 500)

    scheduleTerminalLayout(asXterm(terminal), asFit(fit), container, true, function () {
      return true
    })
    flushFrames()

    expect(fit.fit).not.toHaveBeenCalled()
    expect(observers[0]?.disconnected).toBe(true)
  })

  it('容器已脱离 DOM：回收 observer', function () {
    const terminal = makeTerminal()
    const fit = makeFit(terminal, { cols: 120, rows: 40 })
    const container = makeContainer(900, 500)
    container.remove()

    scheduleTerminalLayout(asXterm(terminal), asFit(fit), container, false, function () {
      return false
    })
    flushFrames()

    expect(fit.fit).not.toHaveBeenCalled()
    expect(observers[0]?.disconnected).toBe(true)
  })

  it('已经 settle 之后 observer 再触发也不会重复 fit', function () {
    const terminal = makeTerminal()
    const fit = makeFit(terminal, { cols: 120, rows: 40 })
    const container = makeContainer(900, 500)

    scheduleTerminalLayout(asXterm(terminal), asFit(fit), container, false, function () {
      return false
    })
    flushFrames()
    expect(fit.fit).toHaveBeenCalledTimes(1)

    observers[0]?.trigger()
    expect(fit.fit).toHaveBeenCalledTimes(1)
  })
})
