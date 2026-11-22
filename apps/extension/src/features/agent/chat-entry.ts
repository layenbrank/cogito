/**
 * 对话页的入口（快捷键 / 工具栏右键）。
 *
 * 扩展只有一个 SPA（`index.html`，同时是新标签页），对话是它的一个 hash 路由
 * （`#/agent/chat`）。这里提供两条入口：
 * - 快捷键 `Ctrl+Shift+K`（manifest 的 `commands`）
 * - 工具栏图标右键 →「打开 Cogito 对话」
 *
 * 为什么不开侧栏：首版对话要独占视口（会话栏 + 对话区），侧栏宽度放不下；
 * 侧栏继续承担「固定当前页 / 书签」那件小事。
 */

const MENU_OPEN_CHAT = 'open-agent-chat'

function openChat(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL('index.html#/agent/chat') })
}

function installChatMenu(): void {
  chrome.contextMenus.create(
    {
      id: MENU_OPEN_CHAT,
      title: '打开 Cogito 对话',
      contexts: ['action']
    },
    function () {
      // worker 重启后会在顶层再跑一次：重复 id 的报错是预期的，读掉它免得多输出一行
      void chrome.runtime.lastError
    }
  )

  chrome.contextMenus.onClicked.addListener(function (info) {
    if (info.menuItemId !== MENU_OPEN_CHAT) return
    openChat()
  })
}

function installChatCommand(): void {
  chrome.commands.onCommand.addListener(function (command) {
    if (command !== 'open-agent') return
    openChat()
  })
}

export { installChatCommand, installChatMenu, openChat }
