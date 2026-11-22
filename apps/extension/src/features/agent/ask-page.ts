/**
 * 右键「问 Cogito」：把网页里选中的一段文字带进对话。
 *
 * 这是扩展相对桌面端唯一真正的增量能力 —— 浏览器里看到什么，就能问什么。
 *
 * 用 `contexts: ['selection']` 而不是自己注入脚本读选区：Chrome 会把 `selectionText`
 * 直接放在点击事件里，省掉 `scripting.executeScript` 的权限面与失败分支。
 */

import { openChat } from '@/features/agent/chat-entry.ts'
import { writePendingContext } from '@/features/page-context/pending.ts'

const MENU_ASK_PAGE = 'ask-cogito-selection'

function installAskPageMenu(): void {
  chrome.contextMenus.create(
    {
      id: MENU_ASK_PAGE,
      title: '问 Cogito 关于这段内容',
      contexts: ['selection']
    },
    function () {
      // worker 重启会在顶层再跑一次：重复 id 的报错是预期的
      void chrome.runtime.lastError
    }
  )

  chrome.contextMenus.onClicked.addListener(function (info, tab) {
    if (info.menuItemId !== MENU_ASK_PAGE) return
    const selection = info.selectionText?.trim()
    if (!selection) return
    void askAboutSelection(selection, tab?.title ?? '', tab?.url ?? '').catch(function (error: unknown) {
      console.error('[ask-page] 交接选区失败', error)
    })
  })
}

async function askAboutSelection(selection: string, title: string, url: string): Promise<void> {
  await writePendingContext({ selection, title, url })
  openChat()
}

export { askAboutSelection, installAskPageMenu }
