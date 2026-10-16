import { viewShortcut } from '@/keyboard/definitions/factory'
import { COMMAND } from '@/keyboard/definitions/ids'
import type { LocalShortcutDefinition } from '@/keyboard/types'

/* ─── directive（编排）工作区（视图级） ─── */

/**
 * 原实现里 `mod+s` / `mod+shift+Enter` 在输入框里也生效，而撤销 / 重做带 `isTyping`
 * 守卫 —— 同样逐键区分。
 */
export const DIRECTIVE_SHORTCUTS: readonly LocalShortcutDefinition[] = [
  viewShortcut(COMMAND.DIRECTIVE_SAVE, '编排窗：保存草稿', 'mod+s', {
    allowInFormTags: true
  }),
  viewShortcut(COMMAND.DIRECTIVE_VALIDATE, '编排窗：校验', 'mod+shift+enter', {
    allowInFormTags: true
  }),
  viewShortcut(COMMAND.DIRECTIVE_UNDO, '编排窗：撤销', 'mod+z'),
  viewShortcut(COMMAND.DIRECTIVE_REDO, '编排窗：重做', 'mod+shift+z', {
    extraBindings: ['mod+y']
  })
]
