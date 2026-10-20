import { viewShortcut } from '@/keyboard/definitions/factory'
import { COMMAND } from '@/keyboard/definitions/ids'
import type { LocalShortcutDefinition } from '@/keyboard/types'

/** 主窗 / Overview 级键位 */
export const OVERVIEW_SHORTCUTS: readonly LocalShortcutDefinition[] = [
  viewShortcut(COMMAND.COMMAND_BAR_FOCUS, '聚焦命令栏', 'mod+k', {
    allowInFormTags: true,
    allowInEditable: true
  })
]
