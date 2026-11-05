/**
 * xterm FitAddon 布局同步：容器尚无尺寸时 fit 会量到 0 列。
 * 交互终端与指令「输出」只读 xterm 共用。
 *
 * 早期用「双 rAF 连拍 60 帧后放弃」：首屏假窄冻结（`LAYOUT_WIDTH_GUARD`）正好落在那
 * 1 秒里，放弃之后只剩 ResizeObserver 的一次机会，于是面板展开/切页签后经常空白。
 * 现在**不设帧数上限**：尺寸为 0 就保持 pending，挂一个 ResizeObserver 等下一次
 * 真实尺寸；一旦 fit 成功立即断开。
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

/**
 * 尝试 fit；失败就等容器下一次尺寸变化，**不放弃**。
 *
 * `isCancelled` 在视图卸载后返回 true：那之后 ResizeObserver 会被断开。
 * 容器长期是 0×0（面板一直没显示）时这里会留一个 observer，数量与视图数同阶，
 * 视图卸载时由 `isCancelled` 在下一帧回调里回收。
 */
function scheduleTerminalLayout(
  terminal: XtermTerminal | null,
  fit: FitAddon | null,
  container: HTMLElement | null,
  shouldFocus: boolean,
  isCancelled: () => boolean
) {
  if (!container) return
  const target = container

  let isSettled = false
  let observer: ResizeObserver | null = null

  function stop() {
    isSettled = true
    observer?.disconnect()
    observer = null
  }

  function attempt() {
    if (isSettled) return
    if (isCancelled() || !target.isConnected) {
      stop()
      return
    }
    if (syncTerminalLayout(terminal, fit, target, shouldFocus)) stop()
  }

  requestAnimationFrame(function () {
    requestAnimationFrame(attempt)
  })

  observer = new ResizeObserver(function () {
    attempt()
  })
  observer.observe(target)
}

export { hasTerminalLayoutSize, scheduleTerminalLayout, syncTerminalLayout }
