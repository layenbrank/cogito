import { getCurrentWindow } from '@tauri-apps/api/window'

/** 当前窗口 label；读不到（单测环境）时返回空串。 */
function findWindowLabel(): string {
  try {
    return getCurrentWindow().label
  } catch (error) {
    console.warn('[window] 读不到当前窗口 label', error)
    return ''
  }
}

export { findWindowLabel }
