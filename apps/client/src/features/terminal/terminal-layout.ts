/**
 * xterm FitAddon 布局同步：容器尚无尺寸时 fit 会量到 0 列。
 * 交互终端与指令「输出」只读 xterm 共用。
 */
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal as XtermTerminal } from '@xterm/xterm'

/** 容器尚无布局尺寸时 fit 会量到 0 列，画面空白且无法输入 */
function hasTerminalLayoutSize(container: HTMLElement | null) {
  if (!container) return false
  return container.clientWidth >= 2 && container.clientHeight >= 2
}

/** fit → refresh → 可选聚焦；双 rAF 等布局稳定（父级刚从 display:none 恢复时尤甚） */
function syncTerminalLayout(
  terminal: XtermTerminal | null,
  fit: FitAddon | null,
  container: HTMLElement | null,
  shouldFocus: boolean
) {
  if (!terminal || !fit) return false
  if (!hasTerminalLayoutSize(container)) return false
  try {
    const beforeCols = terminal.cols
    const beforeRows = terminal.rows
    fit.fit()
    if (terminal.cols < 2 || terminal.rows < 1) return false
    // ConPTY：尺寸没变也强制再 resize 一次，否则晚 attach 常只剩光标、无回放内容
    if (terminal.cols === beforeCols && terminal.rows === beforeRows) {
      terminal.resize(Math.max(2, beforeCols), Math.max(1, beforeRows))
    }
    terminal.refresh(0, terminal.rows - 1)
    if (shouldFocus) terminal.focus()
    return true
  } catch (error) {
    console.debug('xterm sync 未就绪', error)
    return false
  }
}

/** 尺寸未就绪时连拍再 fit；invisible→visible / Splitter 首帧常需远多于 12 帧 */
const LAYOUT_ATTEMPTS = 60

function scheduleTerminalLayout(
  terminal: XtermTerminal | null,
  fit: FitAddon | null,
  container: HTMLElement | null,
  shouldFocus: boolean,
  isCancelled: () => boolean
) {
  let attempts = 0
  function tick() {
    if (isCancelled()) return
    if (syncTerminalLayout(terminal, fit, container, shouldFocus)) return
    attempts += 1
    if (attempts < LAYOUT_ATTEMPTS) requestAnimationFrame(tick)
  }
  requestAnimationFrame(function () {
    requestAnimationFrame(tick)
  })
}

export { hasTerminalLayoutSize, scheduleTerminalLayout, syncTerminalLayout }
