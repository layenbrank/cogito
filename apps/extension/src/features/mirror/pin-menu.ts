/**
 * service worker 里的「右键固定到镜像」那一半。
 *
 * 为什么要单独导出 installer：MV3 一个扩展只允许一个 `background.service_worker`，
 * 而剪藏那半来自 `@cogito/extension-kit/relay`。入口在 `src/entries/worker.ts`，
 * 它把两半在 worker 顶层一起装上（监听器必须同步注册，否则唤醒时事件可能先到）。
 */
import { insertNavigation } from '@/features/mirror/insert.ts'
import { canPin, clipTitle } from '@/features/mirror/pin.ts'

const MENU_PIN = 'pin-navigation'

function installPinMenu(): void {
  chrome.runtime.onInstalled.addListener(function () {
    chrome.contextMenus.removeAll(function () {
      chrome.contextMenus.create({
        id: MENU_PIN,
        title: '固定到 Cogito 新标签',
        contexts: ['page', 'link']
      })
    })
  })

  chrome.contextMenus.onClicked.addListener(function (info, tab) {
    if (info.menuItemId !== MENU_PIN) return

    const url = info.linkUrl ?? tab?.url
    if (!canPin(url)) return

    const title = info.linkUrl ? clipTitle('', url) : clipTitle(tab?.title ?? '', url)

    void insertNavigation(
      {
        title,
        url,
        size: 2,
        shape: 'square',
        direction: 'horizontal'
      },
      { skipSameUrl: true }
    )
      .then(function (result) {
        const badge = result === 'added' ? '✓' : result === 'duplicate' ? '·' : ''
        if (!badge || !chrome.action?.setBadgeText) return
        void chrome.action.setBadgeText({ text: badge })
        setTimeout(function () {
          void chrome.action.setBadgeText({ text: '' })
        }, 2000)
      })
      .catch(function (error: unknown) {
        console.error('[pin] 固定失败', error)
      })
  })
}

export { installPinMenu }
