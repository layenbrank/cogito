import { getCurrentWindow } from '@tauri-apps/api/window'

/** 当前窗口 label；非 Tauri 环境（单测 / 浏览器调试）返回空串。 */
function findWindowLabel(): string {
  if (!('__TAURI_INTERNALS__' in window) && !('__TAURI__' in window)) return ''
  return getCurrentWindow().label
}

export { findWindowLabel }
