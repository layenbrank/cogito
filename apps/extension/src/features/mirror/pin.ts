import { parseSiteUrl } from './url.ts'

/** 只能固定普通网页；浏览器内部页和扩展页本身不能加到镜像 */
export function canPin(url: string | undefined): url is string {
  if (!url) return false
  return parseSiteUrl(url) !== null
}

export function clipTitle(title: string, url: string): string {
  const trimmed = title.trim()
  if (trimmed) return trimmed.slice(0, 80)

  try {
    return new URL(url).hostname
  } catch (error) {
    console.warn('[pin] 无法从链接得到标题', error)
    return url.slice(0, 80)
  }
}
