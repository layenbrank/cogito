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

/**
 * 判「是不是同一个页面」用的归一化：只抹尾部斜杠。
 *
 * `https://a.com` 与 `https://a.com/` 是同一页；但 `#fragment` 必须保留 ——
 * 地址栏只改 hash 时应该是**导航**（同文档跳转），抹掉就会被判成同一页去刷新，
 * 哈希定位直接丢失。
 */
function normalizeAddressKey(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/**
 * 地址栏草稿是否「已改动」。
 *
 * 只影响右侧按钮长相（前往 / 刷新）：空草稿不算改动，`about:blank` 展开成空串后
 * 也不算 —— 空地址栏没有「前往」可言。
 */
function isAddressDirty(draft: string, currentUrl: string): boolean {
  const next = draft.trim()
  if (!next) return false
  return normalizeAddressKey(next) !== normalizeAddressKey(currentUrl)
}

/** 从 URL 取 host；解析不了就原样铺开 */
function findBrowserHost(url: string): string {
  if (!url || url === 'about:blank') return '新标签页'
  try {
    const parsed = new URL(url)
    return parsed.host || parsed.href
  } catch (error) {
    console.debug('browser: 无法解析地址，按原文显示', url, error)
    return url
  }
}

/** tab 标签：优先页面标题，否则 host */
function formatTabTitle(url: string, title?: string | null): string {
  const trimmed = title?.trim()
  if (trimmed) return trimmed
  return findBrowserHost(url)
}

export {
  findBrowserHost,
  formatAddress,
  formatTabTitle,
  isAddressDirty,
  normalizeAddressKey,
  parseAddress
}
