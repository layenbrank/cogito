import { parseSiteUrl } from '@/features/mirror/url.ts'

/** 在新标签打开链接。调用方必须在扩展页面里。 */
export function openSite(url: string, where: 'here' | 'tab'): void {
  const parsed = parseSiteUrl(url)
  if (!parsed) return

  if (where === 'tab') {
    chrome.tabs.create({ url: parsed }, function () {
      const message = chrome.runtime.lastError?.message
      if (message) console.error('[site] 打开失败', message)
    })
    return
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function (found) {
    const id = found[0]?.id
    if (id === undefined) {
      console.error('[site] 没有当前标签')
      return
    }
    chrome.tabs.update(id, { url: parsed }, function () {
      const message = chrome.runtime.lastError?.message
      if (message) console.error('[site] 打开失败', message)
    })
  })
}
