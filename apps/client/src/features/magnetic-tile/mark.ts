const MARK_URL_PATTERN = /^https?:\/\//i
/** 用户新建磁贴无 mark 时的通用兜底（非站点特例） */
const FAVICON_SIZE = 256

function isMarkUrl(mark: string | null | undefined) {
  if (!mark) return false
  return MARK_URL_PATTERN.test(mark.trim())
}

function findTitleInitial(title: string) {
  return [...title].at(0) ?? '?'
}

/** 非 URL 的 mark 或标题首字，供 AvatarFallback / 集合四宫格文字格 */
function findNavigationLabel(mark: string | null | undefined, title: string) {
  if (mark && !isMarkUrl(mark)) {
    const trimmed = mark.trim()
    if (trimmed) return trimmed
  }
  return findTitleInitial(title)
}

function findHostname(url: string | null | undefined) {
  if (!url) return null
  try {
    return new URL(url).hostname || null
  } catch (error) {
    console.debug('[magnetic-tile] 无法解析 hostname:', error)
    return null
  }
}

function buildGoogleFaviconUrl(host: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${FAVICON_SIZE}`
}

/** 仅用于「无预设 mark」的通用回退；不做域名特例 */
function findFaviconFallback(url: string | null | undefined) {
  const host = findHostname(url)
  if (!host) return null
  return buildGoogleFaviconUrl(host)
}

/**
 * 种子 / 已保存磁贴：直接用配置的 mark，不做站点特化改写。
 * - URL → 图标地址
 * - 非空非 URL（如预设字形「天」）→ 不拉 favicon，交给 AvatarFallback
 * - 空 → 通用 favicon 兜底
 */
function findNavigationIconSrc(
  mark: string | null | undefined,
  url: string | null | undefined
) {
  if (isMarkUrl(mark)) return mark!.trim()
  if (mark && mark.trim()) return null
  return findFaviconFallback(url)
}

export {
  buildGoogleFaviconUrl,
  findFaviconFallback,
  findHostname,
  findNavigationIconSrc,
  findNavigationLabel,
  findTitleInitial,
  isMarkUrl
}
