/**
 * 应用壳模式：主窗 / 嵌套预览（右栏 browser webview 自载）/ 纯网页。
 *
 * 右栏子 webview **不配** capability `remote.urls`，没有 IPC。
 * 自载本应用时必须降级：不跑主窗 bootstrap、不碰窗口装饰 API。
 */
import { getCurrentWindow } from '@tauri-apps/api/window'

const EMBEDDED_QUERY = 'embedded'
const EMBEDDED_VALUE = '1'
const MAIN_WINDOW_LABEL = 'main'
const BROWSER_LABEL_PREFIX = 'browser-'

/** SPA 路由丢掉 `?embedded=1` 后仍记住嵌套壳（禁 sessionStorage，只用内存） */
let isEmbeddedAdopted = false

function hasTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}

function readEmbeddedQuery(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).get(EMBEDDED_QUERY) === EMBEDDED_VALUE
  } catch (error) {
    console.warn('[shell-mode] 解析 embedded 查询失败', error)
    return false
  }
}

function findWindowLabelSafe(): string {
  if (!hasTauriRuntime()) return ''
  try {
    return getCurrentWindow().label
  } catch (error) {
    console.warn('[shell-mode] 读不到窗口 label', error)
    return ''
  }
}

/** 是否跑在右栏自载 / `?embedded=1` 降级壳里 */
function isEmbeddedShell(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.shell === 'embedded') {
    return true
  }
  if (readEmbeddedQuery() || isEmbeddedAdopted) return true
  const label = findWindowLabelSafe()
  return label.startsWith(BROWSER_LABEL_PREFIX)
}

/** 真主窗：有 Tauri、label=main、且非 embedded */
function isMainShell(): boolean {
  if (isEmbeddedShell()) return false
  if (!hasTauriRuntime()) return false
  return findWindowLabelSafe() === MAIN_WINDOW_LABEL
}

/**
 * 嵌套壳里 withGlobalTauri 仍会注入 IPC：刷新/无 capability 时 Rust 回包找不到
 * callback，刷屏无意义。只吞这一条，其它 warn 照常。
 */
function softenEmbeddedTauriNoise() {
  if (typeof console === 'undefined' || typeof console.warn !== 'function') return
  const warn = console.warn.bind(console)
  console.warn = function (...args: unknown[]) {
    const head = args[0]
    if (
      typeof head === 'string' &&
      head.includes("[TAURI] Couldn't find callback id")
    ) {
      return
    }
    warn(...args)
  }
}

/**
 * 启动最早调用：把 `?embedded=1` 落到 `data-shell` + 内存标记，
 * 避免客户端路由丢掉 query 后误跑主窗逻辑。
 */
function adoptShellMode() {
  if (typeof document === 'undefined') return
  let embedded = false
  if (readEmbeddedQuery() || isEmbeddedAdopted) {
    embedded = true
  } else {
    const label = findWindowLabelSafe()
    if (label.startsWith(BROWSER_LABEL_PREFIX)) embedded = true
  }
  if (!embedded) return
  document.documentElement.dataset.shell = 'embedded'
  isEmbeddedAdopted = true
  softenEmbeddedTauriNoise()
}

/** 右栏「打开本应用」用的自调试地址（带 embedded） */
function findSelfDebugUrl(path = '/agent/chat'): string {
  const url = new URL(path, window.location.origin)
  url.searchParams.set(EMBEDDED_QUERY, EMBEDDED_VALUE)
  return url.href
}

export {
  adoptShellMode,
  findSelfDebugUrl,
  hasTauriRuntime,
  isEmbeddedShell,
  isMainShell
}
