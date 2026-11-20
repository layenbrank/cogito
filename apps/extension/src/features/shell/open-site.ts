import { parseSiteUrl } from '@/features/mirror/url.ts'

/** 磁贴在当前新标签打开；书签和弹窗另开一个标签 */
export function openSite(url: string, where: 'here' | 'tab'): void {
  const parsed = parseSiteUrl(url)
  if (!parsed) return

  const tabs = globalThis.chrome?.tabs

  if (where === 'tab' && tabs?.create) {
    tabs.create({ url: parsed }, function () {
      const message = chrome.runtime.lastError?.message
      if (message) console.error('[site] 打开失败', message)
    })
    return
  }

  if (where === 'here' && tabs?.query && tabs.update) {
    tabs.query({ active: true, currentWindow: true }, function (found) {
      const id = found[0]?.id
      if (id === undefined) {
        location.assign(parsed)
        return
      }
      tabs.update(id, { url: parsed }, function () {
        const message = chrome.runtime.lastError?.message
        if (!message) return
        console.error('[site] 打开失败', message)
        location.assign(parsed)
      })
    })
    return
  }

  if (where === 'tab') {
    window.open(parsed, '_blank', 'noopener')
    return
  }

  location.assign(parsed)
}
