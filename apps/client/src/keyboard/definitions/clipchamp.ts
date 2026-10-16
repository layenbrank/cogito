import { viewShortcut } from '@/keyboard/definitions/factory'
import { COMMAND } from '@/keyboard/definitions/ids'
import type { LocalShortcutDefinition } from '@/keyboard/types'

/* ─── clipchamp（视频剪辑）窗（视图级） ─── */

/**
 * 焦点策略是**逐键的**：`mod+z` / `mod+s` 原本在 `isTyping` 判断之前，
 * 所以允许在输入框里生效；空格 / S / Delete 原本带 `isTyping` 守卫，保持不允许。
 */
export const CLIPCHAMP_SHORTCUTS: readonly LocalShortcutDefinition[] = [
  viewShortcut(COMMAND.CLIPCHAMP_UNDO, '剪辑窗：撤销', 'mod+z', {
    allowInFormTags: true
  }),
  viewShortcut(COMMAND.CLIPCHAMP_REDO, '剪辑窗：重做', 'mod+shift+z', {
    allowInFormTags: true,
    extraBindings: ['mod+y']
  }),
  viewShortcut(COMMAND.CLIPCHAMP_SAVE, '剪辑窗：保存项目', 'mod+s', {
    allowInFormTags: true
  }),
  viewShortcut(COMMAND.CLIPCHAMP_TOGGLE_PLAY, '剪辑窗：播放 / 暂停', 'space'),
  viewShortcut(COMMAND.CLIPCHAMP_SPLIT, '剪辑窗：在播放头切分', 's'),
  viewShortcut(COMMAND.CLIPCHAMP_REMOVE_SELECTED, '剪辑窗：删除选中片段', 'delete', {
    extraBindings: ['backspace']
  }),
  viewShortcut(COMMAND.CLIPCHAMP_EXIT_FULLSCREEN, '剪辑窗：退出全屏预览', 'escape')
]
