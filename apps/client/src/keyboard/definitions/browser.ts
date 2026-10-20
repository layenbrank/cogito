import { browserShortcut } from '@/keyboard/definitions/factory'
import { COMMAND } from '@/keyboard/definitions/ids'
import type { LocalShortcutDefinition } from '@/keyboard/types'

/**
 * 浏览窗口键位。
 *
 * 与浏览器里的一致：新建/关闭标签、聚焦地址栏、新开窗口。只读 —— 它们是肌肉记忆，
 * 而且改错了会直接和网页自身的按键抢。派发器只在浏览窗口里认它们，
 * 多扇浏览窗口（`browser`、`browser-2`…）共用同一套。
 */
const BROWSER_SHORTCUTS: readonly LocalShortcutDefinition[] = [
  browserShortcut(COMMAND.BROWSER_TAB_NEW, '新建标签', 'mod+t'),
  browserShortcut(COMMAND.BROWSER_TAB_CLOSE, '关闭标签', 'mod+w'),
  browserShortcut(COMMAND.BROWSER_ADDRESS_FOCUS, '聚焦地址栏', 'mod+l'),
  browserShortcut(COMMAND.BROWSER_WINDOW_NEW, '新建浏览窗口', 'mod+n')
]

export { BROWSER_SHORTCUTS }
