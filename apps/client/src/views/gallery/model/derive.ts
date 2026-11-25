import type {
  AlbumCountRow,
  FacetCount,
  GalleryFacets,
  GalleryRow
} from '@/views/gallery/model/asset'
import { createMatchContext, matchesFilter, type GalleryFilterState } from '@/views/gallery/model/filter'
import { VIEW_BY_ID, type GalleryViewID, type ViewContext } from '@/views/gallery/model/views'

/**
 * 派生计算：全部是纯函数，输入 catalog 行，输出网格要渲染的东西。
 *
 * 为什么在这里而不是 SQL：catalog 已经整份在内存里，筛选/排序/分组/计数都是
 * O(n) 的数组操作（10 万行 < 30ms），比每次交互打一轮 IPC 稳定得多。
 */

type GallerySortKey = 'capturedAt' | 'name' | 'size' | 'rating' | 'addedAt'
type SectionScope = 'day' | 'month'

interface GallerySection {
  /** 与 `DateScrubber` 的 `data-gallery-section` 对齐 */
  key: string
  label: string
  rows: GalleryRow[]
}

interface TimelineMark {
  key: string
  label: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function findDayKey(ms: number): string {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function findMonthKey(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function findDayLabel(ms: number): string {
  const date = new Date(ms)
  const today = findDayKey(Date.now())
  const key = findDayKey(ms)
  if (key === today) return '今天'
  const yesterday = findDayKey(Date.now() - DAY_MS)
  if (key === yesterday) return '昨天'
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function findMonthLabel(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}

function sortRows(rows: GalleryRow[], key: GallerySortKey): GalleryRow[] {
  const out = [...rows]
  out.sort(function (a, b) {
    switch (key) {
      case 'name':
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
      case 'size':
        return (b.size ?? 0) - (a.size ?? 0)
      case 'rating':
        return b.rating - a.rating || b.capturedAt - a.capturedAt
      case 'addedAt':
        return b.capturedAt - a.capturedAt
      case 'capturedAt':
      default:
        return b.capturedAt - a.capturedAt
    }
  })
  return out
}

/**
 * 按天/按月切段。段内保持 capturedAt 降序（与全局排序一致，刻度条才对得上）。
 *
 * `isDateSorted` 为 true 时跳过排序：默认排序就是 capturedAt，`findViewRows` 已经排过一遍，
 * 再排一次是白花 O(n log n)（5 万行约十几毫秒，但每次筛选/切视图都要付）。
 */
function findSections(
  rows: GalleryRow[],
  scope: SectionScope,
  isDateSorted = false
): GallerySection[] {
  const sorted = isDateSorted ? rows : sortRows(rows, 'capturedAt')
  const sections: GallerySection[] = []
  const index = new Map<string, GallerySection>()
  for (const row of sorted) {
    const key = scope === 'day' ? findDayKey(row.capturedAt) : findMonthKey(row.capturedAt)
    let section = index.get(key)
    if (!section) {
      section = {
        key,
        label: scope === 'day' ? findDayLabel(row.capturedAt) : findMonthLabel(row.capturedAt),
        rows: []
      }
      index.set(key, section)
      sections.push(section)
    }
    section.rows.push(row)
  }
  return sections
}

/**
 * 刻度条抽样：按天分组时一年就是 365 个刻度，挤在一列里点不中。
 * 等距抽样到 `max` 个，但**永远保留最后一个** —— 否则最新一天在刻度条上点不到。
 */
function sampleTimelineMarks<T extends TimelineMark>(marks: T[], max: number): T[] {
  if (max < 2 || marks.length <= max) return marks
  const step = Math.ceil(marks.length / max)
  const sampled: T[] = []
  for (let index = 0; index < marks.length; index += step) {
    const mark = marks[index]
    if (mark) sampled.push(mark)
  }
  const last = marks[marks.length - 1]
  if (last && sampled[sampled.length - 1]?.key !== last.key) sampled.push(last)
  return sampled
}

/** 字节级重复分组：同一 `dupGroup` 超过 1 行才算重复。 */function findDupCounts(rows: GalleryRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (!row.dupGroup) continue
    counts.set(row.dupGroup, (counts.get(row.dupGroup) ?? 0) + 1)
  }
  const byID = new Map<string, number>()
  for (const row of rows) {
    if (!row.dupGroup) continue
    byID.set(row.id, counts.get(row.dupGroup) ?? 0)
  }
  return byID
}

/** 成组折叠：RAW+JPEG / Live Photo 只显示一张，操作按组展开（见 `expandStack`）。 */
function foldStacks(rows: GalleryRow[]): GalleryRow[] {
  const seen = new Set<string>()
  const out: GalleryRow[] = []
  for (const row of rows) {
    if (!row.stackID) {
      out.push(row)
      continue
    }
    if (seen.has(row.stackID)) continue
    seen.add(row.stackID)
    out.push(row)
  }
  return out
}

/** 把选中项按 stackID 展开成实际要操作的 id 集（删除/重命名必须整组）。 */
function expandStacks(rows: GalleryRow[], ids: Iterable<string>): string[] {
  const selected = new Set(ids)
  const stacks = new Set<string>()
  for (const row of rows) {
    if (selected.has(row.id) && row.stackID) stacks.add(row.stackID)
  }
  const out = new Set<string>()
  for (const row of rows) {
    if (selected.has(row.id) || (row.stackID && stacks.has(row.stackID))) {
      out.add(row.id)
    }
  }
  return [...out]
}

interface GalleryStats {
  total: number
  visible: number
  unrated: number
  rejected: number
  missing: number
}

/**
 * facet 计数：直接由已加载的 catalog 算，不再单独走 IPC。
 *
 * 旧实现是 `gallery:facets` / `gallery:album-counts` 两个命令，各自把**整库**再读一遍
 * （单连接下串行，等于每次刷新做三次全表扫描 + 三遍 JSON 解析）。catalog 本来就在内存里，
 * 这里只是一次 O(n) 遍历。
 */
function findFacets(rows: GalleryRow[]): GalleryFacets {
  const ratings = new Map<string, number>()
  const labels = new Map<string, number>()
  const flags = new Map<string, number>()
  const kinds = new Map<string, number>()
  const years = new Map<string, number>()
  const albums = new Map<string, number>()
  const keywords = new Map<string, number>()

  function bump(target: Map<string, number>, key: string): void {
    target.set(key, (target.get(key) ?? 0) + 1)
  }

  for (const row of rows) {
    bump(ratings, String(row.rating))
    if (row.label) bump(labels, row.label)
    if (row.flag) bump(flags, row.flag)
    bump(kinds, row.kind)
    bump(years, String(new Date(row.capturedAt).getFullYear()))
    for (const albumID of row.albumIDs) bump(albums, albumID)
    for (const keyword of row.keywords) bump(keywords, `${keyword.facet}:${keyword.value}`)
  }

  function toList(source: Map<string, number>): FacetCount[] {
    return [...source].map(function ([value, count]) {
      return { value, count }
    })
  }

  return {
    total: rows.length,
    ratings: toList(ratings),
    labels: toList(labels),
    flags: toList(flags),
    kinds: toList(kinds),
    years: toList(years),
    albums: toList(albums),
    keywords: toList(keywords)
  }
}

/** 相簿角标：catalog 行自带 `albumIDs`，数一遍即可。 */
function findAlbumCounts(rows: GalleryRow[]): AlbumCountRow[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const albumID of row.albumIDs) {
      counts.set(albumID, (counts.get(albumID) ?? 0) + 1)
    }
  }
  return [...counts]
    .map(function ([albumID, count]) {
      return { albumID, count }
    })
    .sort(function (left, right) {
      return right.count - left.count
    })
}

function findStats(rows: GalleryRow[], visible: GalleryRow[]): GalleryStats {
  let unrated = 0
  let rejected = 0
  let missing = 0
  for (const row of rows) {
    if (row.rating === 0 && row.flag !== 'rejected') unrated += 1
    if (row.flag === 'rejected') rejected += 1
    if (row.missing) missing += 1
  }
  return { total: rows.length, visible: visible.length, unrated, rejected, missing }
}

/** 视图 + 筛选 + 折叠 + 排序，一次算完。 */
function findViewRows(
  rows: GalleryRow[],
  viewID: GalleryViewID,
  filter: GalleryFilterState,
  context: ViewContext,
  sortKey: GallerySortKey,
  isFolded: boolean
): GalleryRow[] {
  const view = VIEW_BY_ID.get(viewID) ?? VIEW_BY_ID.get('all')
  // 每轮只为「有搜索条件时」建一次 Set，并把年份换算成毫秒区间
  const matchContext = createMatchContext(filter)
  const matched = rows.filter(function (row) {
    if (!view) return true
    if (!view.match(row, context)) return false
    return matchesFilter(row, filter, matchContext)
  })
  const folded = isFolded ? foldStacks(matched) : matched
  return sortRows(folded, sortKey)
}

function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) return ''
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

export {
  expandStacks,
  findAlbumCounts,
  findDayKey,
  findDayLabel,
  findDupCounts,
  findFacets,
  findMonthKey,
  findSections,
  findStats,
  findViewRows,
  foldStacks,
  formatBytes,
  formatDuration,
  sampleTimelineMarks,
  sortRows
}
export type { GallerySection, GallerySortKey, GalleryStats, SectionScope, TimelineMark }
