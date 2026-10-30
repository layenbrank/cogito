import { viewShortcut } from '@/keyboard/definitions/factory'
import { COMMAND } from '@/keyboard/definitions/ids'
import type { LocalShortcutDefinition } from '@/keyboard/types'

function marketplaceShortcut(
  id: string,
  title: string,
  defaultBinding: string
): LocalShortcutDefinition {
  return viewShortcut(id, title, defaultBinding, {
    allowInFormTags: true,
    allowInEditable: true,
    window: 'any'
  })
}

/** 市场窗键位：仅该窗挂载时通过 useCommands 注册 */
export const MARKETPLACE_SHORTCUTS: readonly LocalShortcutDefinition[] = [
  marketplaceShortcut(COMMAND.MARKETPLACE_FOCUS_SEARCH, '市场：聚焦搜索', 'mod+f'),
  marketplaceShortcut(COMMAND.MARKETPLACE_MODE_BOOTH, '市场：磁贴', 'mod+1'),
  marketplaceShortcut(COMMAND.MARKETPLACE_MODE_NAVIGATE, '市场：网址', 'mod+2'),
  marketplaceShortcut(COMMAND.MARKETPLACE_MODE_CUSTOMIZE, '市场：定制', 'mod+3'),
  marketplaceShortcut(COMMAND.MARKETPLACE_CLEAR_SEARCH, '市场：清除搜索', 'escape')
]
