import { getCurrentWindow } from '@tauri-apps/api/window'

import { hasTauriRuntime } from '@/features/window/shell-mode'

/** 当前窗口 label；单测（jsdom 无 Tauri 运行时）返回空串。环境判定只保留 shell-mode 一处。 */
function findWindowLabel(): string {
  if (!hasTauriRuntime()) return ''
  return getCurrentWindow().label
}

export { findWindowLabel }
