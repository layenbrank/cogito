import { runCommand } from '@/keyboard/commands'
import { COMMAND } from '@/keyboard/definitions/ids'

/**
 * 网页内按键 → 浏览命令。
 *
 * 网页跑在自己的子 WebView 里，壳层收不到它的按键，所以注入脚本把 Ctrl/⌘ + 这几个键
 * 转成宿主消息（`navigation://shortcut`），这里再落到与壳层完全相同的那条命令上，
 * 保证「焦点在地址栏」和「焦点在网页里」表现一致。
 */
const BROWSER_KEYS: Record<string, string> = {
  t: COMMAND.BROWSER_TAB_NEW,
  w: COMMAND.BROWSER_TAB_CLOSE,
  l: COMMAND.BROWSER_ADDRESS_FOCUS,
  n: COMMAND.BROWSER_WINDOW_NEW
}

function runBrowserKey(key: string): void {
  const id = BROWSER_KEYS[key]
  if (!id) return
  void runCommand(id)
}

export { runBrowserKey }
