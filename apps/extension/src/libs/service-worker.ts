/**
 * MV3 service worker：右键把当前页或链接固定到新标签墙。
 * 与新标签页、弹窗、侧栏共用同一个扩展源的 IndexedDB。
 */
import { acceptClipResult } from '@/features/clip-bridge/inbox.ts'
import { insertNavigation } from '@/features/mirror/insert.ts'
import { canPin, clipTitle } from '@/features/mirror/pin.ts'

const MENU_PIN = 'pin-navigation'

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

chrome.runtime.onMessageExternal.addListener(function (message, _sender, sendResponse) {
  if (!acceptClipResult(message)) return false
  sendResponse({ ok: true })
  return true
})
