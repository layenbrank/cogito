import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  type MediaKind,
  type TimeScope
} from '@/views/gallery/constraints'
import type { DateSource } from '@/views/gallery/model/probe-date'

interface GalleryAssetMeta {
  hidden?: boolean
  durationMs?: number
  /** 时间轴排序用：优先 EXIF / 文件名 / mtime */
  capturedAt?: number
  /** 日期来源；缺省表示旧数据，可读时回填 */
  dateSource?: DateSource
  source?: 'import' | 'capture'
  isScreenshot?: boolean
}

interface GalleryAsset {
  id: string
  tenantID: string | null
  kind: string | null
  hash: string | null
  sha: string
  size: number | null
  index: number
  mime: string
  extension: string | null
  fileName: string
  filePath: string
  metadata: string | null
  status: string
  deviceID: string | null
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

interface GalleryMedia {
  asset: GalleryAsset
  kind: MediaKind
  meta: GalleryAssetMeta
  capturedAt: number
  src: string
}

interface DayBucket {
  key: string
  label: string
  medias: GalleryMedia[]
}

interface MonthBucket {
  key: string
  label: string
  days: DayBucket[]
  medias: GalleryMedia[]
}

interface YearBucket {
  key: string
  label: string
  months: MonthBucket[]
  medias: GalleryMedia[]
}

function parseMeta(raw: string | null | undefined): GalleryAssetMeta {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as GalleryAssetMeta
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function stringifyMeta(meta: GalleryAssetMeta): string {
  return JSON.stringify(meta)
}

function findExtension(fileName: string, extension: string | null): string {
  if (extension) return extension.replace(/^\./, '').toLowerCase()
  const parts = fileName.split('.')
  if (parts.length < 2) return ''
  return parts[parts.length - 1]!.toLowerCase()
}

function findMediaKind(asset: GalleryAsset): MediaKind | null {
  if (asset.kind === 'image' || asset.kind === 'video') return asset.kind
  if (asset.mime.startsWith('image/')) return 'image'
  if (asset.mime.startsWith('video/')) return 'video'
  const ext = findExtension(asset.fileName, asset.extension)
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image'
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return 'video'
  return null
}

/** 常见截图工具 / 系统截屏命名 */
const SCREENSHOT_NAME =
  /(?:^|[_-\s])(?:screenshot|screen[_-]?shot|screen[_-]?clip|pixpin|snipaste|sharex|flameshot|截屏|截图|屏幕截图)(?:[_-\s.]|$)/i

function isLikelyScreenshot(asset: GalleryAsset, meta: GalleryAssetMeta): boolean {
  if (meta.isScreenshot) return true
  if (meta.source === 'capture') return true
  const path = asset.filePath.replace(/\\/g, '/').toLowerCase()
  if (path.includes('/textures/')) return true
  return SCREENSHOT_NAME.test(asset.fileName) || SCREENSHOT_NAME.test(path)
}

function findPhotos(medias: GalleryMedia[]): GalleryMedia[] {
  return medias.filter(function (media) {
    return media.kind === 'image' && !isLikelyScreenshot(media.asset, media.meta)
  })
}

function findCapturedAt(asset: GalleryAsset, meta: GalleryAssetMeta): number {
  if (typeof meta.capturedAt === 'number' && Number.isFinite(meta.capturedAt)) {
    return meta.capturedAt
  }
  return asset.createdAt
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDayKey(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function formatMonthKey(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

function formatYearKey(ms: number): string {
  return String(new Date(ms).getFullYear())
}

function formatDayLabel(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function formatMonthLabel(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}

function formatYearLabel(ms: number): string {
  return `${new Date(ms).getFullYear()}年`
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms < 0) return ''
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${pad2(seconds)}`
}

function toGalleryMedia(asset: GalleryAsset, src: string): GalleryMedia | null {
  if (asset.archivedAt) return null
  const kind = findMediaKind(asset)
  if (!kind) return null
  const meta = parseMeta(asset.metadata)
  if (!meta.source && isLikelyScreenshot(asset, meta)) {
    meta.source = 'capture'
    meta.isScreenshot = true
  }
  return {
    asset,
    kind,
    meta,
    capturedAt: findCapturedAt(asset, meta),
    src
  }
}

function filterVisible(
  medias: GalleryMedia[],
  options: { includeHidden?: boolean; onlyHidden?: boolean } = {}
): GalleryMedia[] {
  const includeHidden = options.includeHidden === true
  const onlyHidden = options.onlyHidden === true
  return medias.filter(function (media) {
    const isHidden = media.meta.hidden === true
    if (onlyHidden) return isHidden
    if (!includeHidden && isHidden) return false
    return true
  })
}

function sortByCapturedAt(medias: GalleryMedia[]): GalleryMedia[] {
  return medias.slice().sort(function (a, b) {
    return b.capturedAt - a.capturedAt
  })
}

function groupByDay(medias: GalleryMedia[]): DayBucket[] {
  const map = new Map<string, DayBucket>()
  for (const media of sortByCapturedAt(medias)) {
    const key = formatDayKey(media.capturedAt)
    let bucket = map.get(key)
    if (!bucket) {
      bucket = {
        key,
        label: formatDayLabel(media.capturedAt),
        medias: []
      }
      map.set(key, bucket)
    }
    bucket.medias.push(media)
  }
  return Array.from(map.values())
}

function groupByMonth(medias: GalleryMedia[]): MonthBucket[] {
  const map = new Map<string, MonthBucket>()
  for (const media of sortByCapturedAt(medias)) {
    const key = formatMonthKey(media.capturedAt)
    let bucket = map.get(key)
    if (!bucket) {
      bucket = {
        key,
        label: formatMonthLabel(media.capturedAt),
        days: [],
        medias: []
      }
      map.set(key, bucket)
    }
    bucket.medias.push(media)
  }
  return Array.from(map.values()).map(function (bucket) {
    return {
      ...bucket,
      days: groupByDay(bucket.medias)
    }
  })
}

function groupByYear(medias: GalleryMedia[]): YearBucket[] {
  const map = new Map<string, YearBucket>()
  for (const media of sortByCapturedAt(medias)) {
    const key = formatYearKey(media.capturedAt)
    let bucket = map.get(key)
    if (!bucket) {
      bucket = {
        key,
        label: formatYearLabel(media.capturedAt),
        months: [],
        medias: []
      }
      map.set(key, bucket)
    }
    bucket.medias.push(media)
  }
  return Array.from(map.values()).map(function (bucket) {
    return {
      ...bucket,
      months: groupByMonth(bucket.medias)
    }
  })
}

function findScopeBuckets(medias: GalleryMedia[], scope: TimeScope) {
  if (scope === 'years') return groupByYear(medias)
  if (scope === 'months') return groupByMonth(medias)
  return groupByDay(medias)
}

function findVideos(medias: GalleryMedia[]): GalleryMedia[] {
  return medias.filter(function (media) {
    return media.kind === 'video'
  })
}

function findScreenshots(medias: GalleryMedia[]): GalleryMedia[] {
  return medias.filter(function (media) {
    return isLikelyScreenshot(media.asset, media.meta)
  })
}

function findHidden(medias: GalleryMedia[]): GalleryMedia[] {
  return medias.filter(function (media) {
    return media.meta.hidden === true
  })
}

function mergeMeta(asset: GalleryAsset, patch: Partial<GalleryAssetMeta>): string {
  return stringifyMeta({ ...parseMeta(asset.metadata), ...patch })
}

function findMimeFromPath(path: string): { mime: string; kind: MediaKind; extension: string } {
  const name = path.replace(/\\/g, '/').split('/').pop() || path
  const extension = findExtension(name, null)
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(extension)) {
    const mime =
      extension === 'webm'
        ? 'video/webm'
        : extension === 'mov'
          ? 'video/quicktime'
          : 'video/mp4'
    return { mime, kind: 'video', extension }
  }
  const mime =
    extension === 'png'
      ? 'image/png'
      : extension === 'gif'
        ? 'image/gif'
        : extension === 'webp'
          ? 'image/webp'
          : 'image/jpeg'
  return { mime, kind: 'image', extension }
}

export {
  filterVisible,
  findCapturedAt,
  findHidden,
  findMediaKind,
  findMimeFromPath,
  findPhotos,
  findScopeBuckets,
  findScreenshots,
  findVideos,
  formatDayKey,
  formatDuration,
  formatMonthKey,
  formatYearKey,
  groupByDay,
  groupByMonth,
  groupByYear,
  isLikelyScreenshot,
  mergeMeta,
  parseMeta,
  sortByCapturedAt,
  stringifyMeta,
  toGalleryMedia
}

export type {
  DayBucket,
  GalleryAsset,
  GalleryAssetMeta,
  GalleryMedia,
  MonthBucket,
  YearBucket
}
