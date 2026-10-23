import { viewShortcut } from '@/keyboard/definitions/factory'
import { COMMAND } from '@/keyboard/definitions/ids'
import type { LocalShortcutDefinition } from '@/keyboard/types'

/* ─── morph（PDF 标注）工具切换（视图级） ─── */

/**
 * 裸字母键只在 morph 工作区挂载时才认（命令注册即门控），输入框 / contenteditable 里
 * 默认不认 —— 每项都继承公开默认值。
 */
export const MORPH_SHORTCUTS: readonly LocalShortcutDefinition[] = [
  viewShortcut(COMMAND.MORPH_TOOL_SELECT, 'PDF 标注：选择工具', 's'),
  viewShortcut(COMMAND.MORPH_TOOL_TEXT, 'PDF 标注：文本工具', 't'),
  viewShortcut(COMMAND.MORPH_TOOL_HIGHLIGHT, 'PDF 标注：高亮工具', 'h'),
  viewShortcut(COMMAND.MORPH_TOOL_SHAPE, 'PDF 标注：形状工具', 'r'),
  viewShortcut(COMMAND.MORPH_TOOL_STAMP, 'PDF 标注：签章工具', 'p')
]
