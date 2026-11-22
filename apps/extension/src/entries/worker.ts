/**
 * 唯一的 MV3 service worker：把两半装上。
 *
 * - 右键「固定到新标签」：`features/mirror/pin-menu.ts`（本应用自己的）
 * - 剪藏当前页：`@cogito/extension-kit/relay`（剪藏那半，来自 packages/extension-kit）
 *
 * 之前它们是两个扩展、各一个 worker，靠 `externally_connectable` 与手填对方的扩展 ID 互调；
 * 合并成一个扩展后只能有一个 worker，于是入口放这里、两半在顶层同步注册
 * （MV3 唤醒 worker 时事件可能立刻到达，异步注册会漏）。
 */
import { installClipRelay } from '@cogito/extension-kit/relay'

import { installAskPageMenu } from '@/features/agent/ask-page.ts'
import { installChatCommand, installChatMenu } from '@/features/agent/chat-entry.ts'
import { installPinMenu } from '@/features/mirror/pin-menu.ts'

installPinMenu()
installClipRelay()
// 对话页入口（Ctrl+Shift+K / 工具栏右键）：同样必须顶层同步注册
installChatCommand()
installChatMenu()
// 选中文字右键「问 Cogito 关于这段内容」
installAskPageMenu()
