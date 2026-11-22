/**
 * 站点图标。扩展里只用 Chrome 的 `_favicon`，不走公网图标服务。
 */
const MARK_URL_PATTERN = /^(https?:|chrome-extension:)/i

function isMarkUrl(mark: string | null | undefined): boolean {
  if (!mark) return false
  return MARK_URL_PATTERN.test(mark.trim())
}

function findTitleInitial(title: string): string {
  return [...title].at(0) ?? '?'
}

function findNavigationLabel(mark: string | null | undefined, title: string): string {
  if (mark && !isMarkUrl(mark)) {
    const trimmed = mark.trim()
    if (trimmed) return trimmed
  }
  return findTitleInitial(title)
}

function findSiteMark(url: string): string | null {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch (error) {
    console.warn('[tile] 无法解析链接', error)
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  const icon = new URL(chrome.runtime.getURL('_favicon/'))
  icon.searchParams.set('pageUrl', url)
  icon.searchParams.set('size', '64')
  return icon.toString()
}

function findNavigationIconSrc(mark: string | null | undefined, url: string | null | undefined): string | null {
  if (isMarkUrl(mark)) return mark!.trim()
  if (mark && mark.trim()) return null
  if (!url) return null
  return findSiteMark(url)
}

export { findNavigationIconSrc, findNavigationLabel, findSiteMark, findTitleInitial, isMarkUrl }
