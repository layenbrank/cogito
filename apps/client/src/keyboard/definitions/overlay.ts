import { overlayShortcut } from '@/keyboard/definitions/factory'
import { COMMAND } from '@/keyboard/definitions/ids'
import type { LocalShortcutDefinition } from '@/keyboard/types'

/* ─── 截屏浮层（overlay 窗；Esc / 撤销 / 重做这类只读的肌肉记忆键位） ─── */

export const OVERLAY_SHORTCUTS: readonly LocalShortcutDefinition[] = [
  overlayShortcut(COMMAND.OVERLAY_ESCAPE, '截屏：退出 / 逐级回退', 'escape'),
  overlayShortcut(COMMAND.CAPTURE_UNDO, '截屏：撤销标注', 'mod+z'),
  overlayShortcut(COMMAND.CAPTURE_REDO, '截屏：重做标注', 'mod+shift+z', {
    extraBindings: ['mod+y']
  }),
  overlayShortcut(COMMAND.CAPTURE_DELETE_SELECTION, '截屏：删除选中标注', 'delete', {
    extraBindings: ['backspace']
  }),
  overlayShortcut(COMMAND.CAPTURE_RETAKE, '截屏：重新截图', 'mod+r')
]
