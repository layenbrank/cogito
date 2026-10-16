import { COMMAND } from '@/keyboard/definitions/ids'
import type { GlobalShortcutDefinition } from '@/keyboard/types'

/* ─── 全局键（OS 级；只在主窗注册，任何应用在前台都能触发） ─── */

export const GLOBAL_SHORTCUTS: readonly GlobalShortcutDefinition[] = [
  {
    scope: 'global',
    id: COMMAND.CAPTURE_SCREENSHOT,
    title: '截屏',
    defaultBinding: 'Alt+Q',
    // 被系统或其它应用占用时依次尝试；只改运行时生效值，不覆写用户设置
    fallbacks: ['Control+Alt+Q', 'Alt+Shift+Q', 'Control+Shift+Q'],
    isConfigurable: true
  }
]
