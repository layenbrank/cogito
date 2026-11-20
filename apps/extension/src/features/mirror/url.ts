/** 只接受带主机名的 http(s)，避免把浏览器内部页或脚本地址写进墙 */
export function parseSiteUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    return url.toString()
  } catch (error) {
    console.warn('[site] 无法解析链接', error)
    return null
  }
}
