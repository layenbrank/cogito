/**
 * 地址栏输入 → 真正的 URL。
 *
 * 浏览器行为对齐：带 scheme 原样用；`localhost:3000` / 裸 IP 走 http；
 * 其余补 `https://`。不猜搜索词 —— 猜错会把 `foo bar` 拼成域名，不如让 webview 报错。
 *
 * 注意 `SCHEME` 必须带 `//`：`localhost:3000` 里的 `localhost:` 长得也像 scheme，
 * 只认 `xxx://` 才不会把它当成协议。不跟 `//` 的协议（`about:` / `data:` …）单列白名单。
 */
const WITH_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\//i
const OPAQUE_SCHEME = /^(?:about|data|blob|file|mailto|tel|view-source|chrome|edge):/i
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]|$)/
const LOCAL = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i

function parseAddress(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (WITH_AUTHORITY.test(trimmed) || OPAQUE_SCHEME.test(trimmed)) return trimmed
  if (IPV4.test(trimmed) || LOCAL.test(trimmed)) return `http://${trimmed}`
  return `https://${trimmed}`
}

/** 地址栏展示用：去掉尾部斜杠之外不再加工，保证「看到的能直接改再提交」 */
function formatAddress(url: string): string {
  return url === 'about:blank' ? '' : url
}

/** tab 标签：和浏览器一样显示 host，解析不了就原样铺开 */
function formatTabTitle(url: string): string {
  if (!url || url === 'about:blank') return '新标签页'
  try {
    const parsed = new URL(url)
    return parsed.host || parsed.href
  } catch (error) {
    // `about:` / `data:` 之类不是标准层次 URL，原样显示即可
    console.debug('browser: 无法解析地址，按原文显示', url, error)
    return url
  }
}

export { formatAddress, formatTabTitle, parseAddress }
