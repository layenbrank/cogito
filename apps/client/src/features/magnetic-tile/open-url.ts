/**
 * 打开网址的桥。
 *
 * 监听放在常驻宿主上，因为浏览器壳只在 `/overview` 挂着。
 * 壳在时直接交给它；壳不在时先记下地址，等回到主页再打开。
 */

const NAVIGATION_OPEN_URL = 'navigation://open-url'

type OpenHandler = (url: string) => void

let handler: OpenHandler | null = null
let pendingUrl: string | null = null

function bindBrowserOpen(next: OpenHandler) {
  handler = next
  if (pendingUrl !== null) {
    const url = pendingUrl
    pendingUrl = null
    next(url)
  }
  return function () {
    if (handler === next) handler = null
  }
}

/** 壳已挂上则立刻打开，并返回 true。否则记下地址，调用方负责回到主页。 */
function requestBrowserOpen(url: string) {
  if (handler) {
    handler(url)
    return true
  }
  pendingUrl = url
  return false
}

export { bindBrowserOpen, NAVIGATION_OPEN_URL, requestBrowserOpen }
