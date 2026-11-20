/**
 * 站点图标地址。
 * 扩展里走 Chrome 自带的 `_favicon`（需要 manifest 的 `favicon` 权限）；
 * 普通网页调试时退回公开的站点图标服务。
 */
export function findSiteMark(url: string): string | null {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch (error) {
    console.warn('[tile] 无法解析链接', error)
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  const runtime = globalThis.chrome?.runtime
  if (runtime?.id) {
    const icon = new URL(runtime.getURL('_favicon/'))
    icon.searchParams.set('pageUrl', url)
    icon.searchParams.set('size', '64')
    return icon.toString()
  }

  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(parsed.hostname)}`
}
