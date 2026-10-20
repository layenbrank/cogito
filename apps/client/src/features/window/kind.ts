import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * 窗口种类与 label 规则（与 Rust 侧 `navigation/command.rs` 的常量一一对应）。
 *
 * 浏览窗口可以有任意多扇（`browser`、`browser-2`…），浮层则一扇窗口一个
 * （`navigation-popup-<宿主>`）。判定集中在这里，避免各入口各写一套前缀比较。
 */
const BROWSER = 'browser'
const POPUP_PREFIX = 'navigation-popup-'

/** 当前窗口 label；非 Tauri 环境（单测 / 浏览器调试）返回空串。 */
function findWindowLabel(): string {
  if (!('__TAURI_INTERNALS__' in window) && !('__TAURI__' in window)) return ''
  return getCurrentWindow().label
}

/** 是不是浏览窗口（`browser`、`browser-2`…）。 */
function isBrowserWindow(label: string): boolean {
  if (label === BROWSER) return true
  if (!label.startsWith(`${BROWSER}-`)) return false
  return /^\d+$/.test(label.slice(BROWSER.length + 1))
}

/** 是不是地址建议浮层。 */
function isPopupWindow(label: string): boolean {
  return label.startsWith(POPUP_PREFIX)
}

/** 某扇浏览窗口的浮层 label。浮层按窗口隔离，互不共用。 */
function findPopupLabel(hostLabel: string = findWindowLabel()): string {
  return `${POPUP_PREFIX}${hostLabel}`
}

export { findPopupLabel, findWindowLabel, isBrowserWindow, isPopupWindow }
