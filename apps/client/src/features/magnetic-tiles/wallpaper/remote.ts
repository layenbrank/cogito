/**
 * 壁纸库的在线图源。
 *
 * - NASA Images API：公有领域，挑宽度够做壁纸的 JPEG。
 * - 维基共享精选：CC0 / CC BY / CC BY-SA 可商用，画面上保留署名与许可。
 * - 必应每日：`HPImageArchive` 大约一周、各市场去重后十几张。版权归摄影师，只适合个人壁纸。
 *
 * 浏览器里维基、NASA 带 CORS；必应没有，桌面壳用 Tauri HTTP。失败只打日志，不把空结果写进缓存。
 */
import type { WallpaperFrame } from './catalog'

type WallpaperSource = 'commons' | 'nasa' | 'bing'

interface NasaLink {
  href?: string
  render?: string
  width?: number
}

interface NasaItem {
  data?: Array<{ title?: string; nasa_id?: string }>
  links?: NasaLink[]
}

interface BingImage {
  urlbase?: string
  title?: string
  copyright?: string
}

interface WikiInfo {
  thumburl?: string
  thumbwidth?: number
  mime?: string
  extmetadata?: {
    LicenseShortName?: { value?: string }
    Artist?: { value?: string }
  }
}

interface WikiPage {
  title?: string
  imageinfo?: WikiInfo[]
}

const NASA_API = 'https://images-api.nasa.gov/search'
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const BING_ARCHIVE = 'https://www.bing.com/HPImageArchive.aspx'
const BING_ORIGIN = 'https://www.bing.com'
const REQUEST_AGENT = 'CogitoWallpaper/1.0 (desktop wallpaper library)'

const NASA_QUERIES = ['earth', 'nebula', 'galaxy', 'mars', 'jupiter', 'saturn', 'aurora', 'moon']
const NASA_PAGE_SIZE = '40'
const NASA_MIN_WIDTH = 1280
const NASA_FIT_WIDTH = 1600
const NASA_SKIP_TITLE = /astronaut|cosmonaut|portrait|spacewalk|\bcrew\b/i

const COMMONS_SEARCHES: ReadonlyArray<{ category: string; offset: number }> = [
  { category: 'Featured_pictures_of_landscapes', offset: 0 },
  { category: 'Featured_pictures_of_landscapes', offset: 50 },
  { category: 'Featured_pictures_of_coasts', offset: 0 },
  { category: 'Featured_pictures_of_cities', offset: 0 }
]
const COMMONS_MIN_WIDTH = 1600
const COMMONS_USABLE = /^(CC0|CC BY\b|CC BY-SA\b|Public domain)/i
const COMMONS_BLOCKED = /\b(NC|ND)\b/

const BING_MARKETS = ['zh-CN', 'en-US', 'ja-JP', 'en-GB', 'de-DE', 'fr-FR', 'en-AU', 'en-IN']
const BING_COUNT = '8'

const shelfCache = new Map<WallpaperSource, WallpaperFrame[]>()

function hasTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}

function toHttps(href: string) {
  return href.replace(/^http:\/\//i, 'https://')
}

function uniqueFrames(frames: WallpaperFrame[], findKey: (frame: WallpaperFrame) => string) {
  const seen = new Set<string>()
  const unique: WallpaperFrame[] = []
  for (const frame of frames) {
    const key = findKey(frame)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(frame)
  }
  return unique
}

function findFittedLink(links: NasaLink[]) {
  const photos = links.filter(function (link) {
    return Boolean(link.href) && link.render === 'image' && /\.jpe?g(\?|$)/i.test(link.href ?? '')
  })
  const ranked = photos.slice().sort(function (left, right) {
    return (left.width ?? 0) - (right.width ?? 0)
  })
  const fitted = ranked.find(function (link) {
    return (link.width ?? 0) >= NASA_FIT_WIDTH
  })
  if (fitted?.href) return fitted
  const widest = ranked[ranked.length - 1]
  if ((widest?.width ?? 0) >= NASA_MIN_WIDTH && widest?.href) return widest
  return undefined
}

function findThumbLink(links: NasaLink[], stage: string) {
  const thumbs = links.filter(function (link) {
    const href = link.href ?? ''
    return link.render === 'image' && href && href !== stage && /~(?:thumb|small)\./i.test(href)
  })
  const smallest = thumbs.slice().sort(function (left, right) {
    return (left.width ?? 0) - (right.width ?? 0)
  })[0]
  return smallest?.href ? toHttps(smallest.href) : undefined
}

function parseNasaCatalog(payload: unknown): WallpaperFrame[] {
  const items = (payload as { collection?: { items?: NasaItem[] } }).collection?.items ?? []
  const frames: WallpaperFrame[] = []
  for (const item of items) {
    const meta = item.data?.[0]
    const title = meta?.title?.trim() || meta?.nasa_id || 'NASA'
    if (NASA_SKIP_TITLE.test(title)) continue
    const links = item.links ?? []
    const stage = findFittedLink(links)
    if (!stage?.href) continue
    const src = toHttps(stage.href)
    frames.push({
      src,
      thumb: findThumbLink(links, stage.href),
      title,
      credit: 'NASA'
    })
  }
  return uniqueFrames(frames, function (frame) {
    return frame.src
  })
}

function parsePlainText(value: string | undefined) {
  return (value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseCommonsTitle(title: string) {
  return title
    .replace(/^File:/i, '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/_/g, ' ')
    .trim()
}

function findWikiThumb(stage: string) {
  return stage.replace(/\/\d+px-/i, '/960px-')
}

function isCommonsPhoto(info: WikiInfo, license: string) {
  if (COMMONS_BLOCKED.test(license) || !COMMONS_USABLE.test(license)) return false
  if ((info.thumbwidth ?? 0) < COMMONS_MIN_WIDTH || !info.thumburl) return false
  const mime = info.mime ?? ''
  if (mime && !/^image\/(jpeg|png|webp)$/i.test(mime)) return false
  return true
}

function parseCommonsCatalog(payload: unknown): WallpaperFrame[] {
  const pages = (payload as { query?: { pages?: Record<string, WikiPage> } }).query?.pages ?? {}
  const frames: WallpaperFrame[] = []
  for (const page of Object.values(pages)) {
    const info = page.imageinfo?.[0]
    if (!info) continue
    const license = parsePlainText(info.extmetadata?.LicenseShortName?.value)
    if (!isCommonsPhoto(info, license)) continue
    const src = info.thumburl ?? ''
    const artist = parsePlainText(info.extmetadata?.Artist?.value)
    frames.push({
      src,
      thumb: findWikiThumb(src),
      title: parseCommonsTitle(page.title ?? '维基共享'),
      credit: artist ? `${artist} · ${license}` : license
    })
  }
  return frames
}

function findBingScene(urlbase: string) {
  const matched = /OHR\.([^_&]+)/.exec(urlbase)
  return matched?.[1] ?? urlbase
}

function parseBingArchive(payload: unknown): WallpaperFrame[] {
  const images = (payload as { images?: BingImage[] }).images ?? []
  const frames: WallpaperFrame[] = []
  for (const image of images) {
    if (!image.urlbase?.startsWith('/th?')) continue
    frames.push({
      src: `${BING_ORIGIN}${image.urlbase}_1920x1080.jpg`,
      thumb: `${BING_ORIGIN}${image.urlbase}_800x480.jpg`,
      title: image.title?.trim() || '必应壁纸',
      credit: image.copyright?.trim() || '© Bing'
    })
  }
  return uniqueFrames(frames, function (frame) {
    return findBingScene(frame.src)
  })
}

function findNasaSearchUrl(query: string) {
  const params = new URLSearchParams({
    q: query,
    media_type: 'image',
    page_size: NASA_PAGE_SIZE
  })
  return `${NASA_API}?${params}`
}

function findCommonsSearchUrl(category: string, offset: number) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `incategory:${category}`,
    gsrnamespace: '6',
    gsrlimit: '50',
    gsroffset: String(offset),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1920',
    format: 'json',
    origin: '*'
  })
  return `${COMMONS_API}?${params}`
}

function findBingArchiveUrl(market: string) {
  const params = new URLSearchParams({
    format: 'js',
    idx: '0',
    n: BING_COUNT,
    mkt: market
  })
  return `${BING_ARCHIVE}?${params}`
}

async function fetchJson<T>(url: string): Promise<T> {
  const headers = { Accept: 'application/json', 'User-Agent': REQUEST_AGENT }
  if (hasTauriRuntime()) {
    const { http } = await import('@/utils/http/http')
    return http.get<T>(url, { headers })
  }
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.json() as Promise<T>
}

async function fetchSettledFrames(
  urls: readonly string[],
  parse: (payload: unknown) => WallpaperFrame[],
  label: string
) {
  const settled = await Promise.allSettled(
    urls.map(function (url) {
      return fetchJson<unknown>(url)
    })
  )
  const frames: WallpaperFrame[] = []
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.warn(`[wallpaper] ${label}读取失败`, result.reason)
      continue
    }
    frames.push(...parse(result.value))
  }
  return frames
}

async function fetchCommonsShelf() {
  const urls = COMMONS_SEARCHES.map(function (search) {
    return findCommonsSearchUrl(search.category, search.offset)
  })
  const frames = await fetchSettledFrames(urls, parseCommonsCatalog, '维基共享')
  return uniqueFrames(frames, function (frame) {
    return frame.src
  })
}

async function fetchNasaShelf() {
  const urls = NASA_QUERIES.map(findNasaSearchUrl)
  const frames = await fetchSettledFrames(urls, parseNasaCatalog, 'NASA')
  return uniqueFrames(frames, function (frame) {
    return frame.title.trim().toLowerCase()
  })
}

async function fetchBingShelf() {
  const urls = BING_MARKETS.map(findBingArchiveUrl)
  const frames = await fetchSettledFrames(urls, parseBingArchive, '必应')
  return uniqueFrames(frames, function (frame) {
    return findBingScene(frame.src)
  })
}

async function fetchSource(source: WallpaperSource) {
  if (source === 'commons') return fetchCommonsShelf()
  if (source === 'nasa') return fetchNasaShelf()
  return fetchBingShelf()
}

function findCachedWallpaperShelf(source: WallpaperSource) {
  return shelfCache.get(source)
}

async function fetchWallpaperShelf(source: WallpaperSource) {
  const cached = shelfCache.get(source)
  if (cached) return cached
  const frames = await fetchSource(source)
  if (frames.length) shelfCache.set(source, frames)
  return frames
}

export {
  fetchWallpaperShelf,
  findCachedWallpaperShelf,
  parseBingArchive,
  parseCommonsCatalog,
  parseNasaCatalog
}
export type { WallpaperSource }
