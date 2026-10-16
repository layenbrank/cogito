import { viewShortcut } from '@/keyboard/definitions/factory'
import { COMMAND } from '@/keyboard/definitions/ids'
import type { LocalShortcutDefinition } from '@/keyboard/types'

/* ─── code 窗（视图级） ─── */

/**
 * Monaco 的输入区是个 textarea —— 不开 `allowInFormTags`，在编辑器里按 Ctrl+S 会直接
 * 落到浏览器默认行为上。本组键位一律要在输入区生效。
 */
function codeShortcut(id: string, title: string, defaultBinding: string): LocalShortcutDefinition {
  return viewShortcut(id, title, defaultBinding, { allowInFormTags: true })
}

export const CODE_SHORTCUTS: readonly LocalShortcutDefinition[] = [
  codeShortcut(COMMAND.CODE_PALETTE_COMMANDS, '代码窗：显示所有命令', 'mod+shift+p'),
  codeShortcut(COMMAND.CODE_PALETTE_FILES, '代码窗：转到文件', 'mod+p'),
  codeShortcut(COMMAND.CODE_SAVE, '代码窗：保存文件', 'mod+s'),
  codeShortcut(COMMAND.CODE_CLOSE_TAB, '代码窗：关闭当前标签', 'mod+w'),
  codeShortcut(COMMAND.CODE_OPEN_FOLDER, '代码窗：打开文件夹', 'mod+o'),
  codeShortcut(COMMAND.CODE_TOGGLE_SIDEBAR, '代码窗：切换侧栏', 'mod+b'),
  codeShortcut(COMMAND.CODE_TERMINAL, '代码窗：切换终端', 'mod+`')
]
