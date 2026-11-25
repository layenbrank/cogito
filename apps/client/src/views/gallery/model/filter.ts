import type { GalleryFlag, GalleryKind, GalleryLabel, GalleryRow } from '@/views/gallery/model/asset'

/**
 * 筛选状态：可序列化（智能相簿把它整份存进 `gallerySmartAlbum.query`）。
 *
 * 版本号进 JSON —— 字段语义以后要改时，老规则能识别并降级，而不是静默匹配错。
 */
interface GalleryFilterState {
  /** 局部文字筛选生效后的 id 集（由 `gallery:search` 算好；null = 未启用文字筛选） */
  searchIDs: string[] | null
  /** 空 = 不限 */
  ratings: number[]
  minRating: number | null
  flags: GalleryFlag[]
  labels: GalleryLabel[]
  kinds: GalleryKind[]
  yearFrom: number | null
  yearTo: number | null
  albumIDs: string[]
  /** "people:妈妈" */
  keywords: string[]
  includeHidden: boolean
  onlyMissing: boolean
}

const FILTER_SCHEMA_VER = 1

function createFilter(): GalleryFilterState {
  return {
    searchIDs: null,
    ratings: [],
    minRating: null,
    flags: [],
    labels: [],
    kinds: [],
    yearFrom: null,
    yearTo: null,
    albumIDs: [],
    keywords: [],
    includeHidden: false,
    onlyMissing: false
  }
}

function isFilterEmpty(filter: GalleryFilterState): boolean {
  return (
    filter.searchIDs === null &&
    filter.ratings.length === 0 &&
    filter.minRating === null &&
    filter.flags.length === 0 &&
    filter.labels.length === 0 &&
    filter.kinds.length === 0 &&
    filter.yearFrom === null &&
    filter.yearTo === null &&
    filter.albumIDs.length === 0 &&
    filter.keywords.length === 0 &&
    !filter.onlyMissing
  )
}

/** 预处理后的筛选上下文：每轮筛选只算一次，避免逐行构造 `Set` / `Date`。 */
interface MatchContext {
  searchSet: Set<string> | null
  ratingSet: Set<number> | null
  flagSet: Set<GalleryFlag> | null
  labelSet: Set<GalleryLabel> | null
  kindSet: Set<GalleryKind> | null
  albumIDSet: Set<string> | null
  keywordSet: Set<string> | null
  /** 起始年 1 月 1 日 00:00（本地时区）的毫秒值；null = 不限 */
  yearFrom: number | null
  /** 截止年**次年** 1 月 1 日（不含）；null = 不限 */
  yearTo: number | null
}

function createMatchContext(filter: GalleryFilterState): MatchContext {
  return {
    searchSet: filter.searchIDs ? new Set(filter.searchIDs) : null,
    ratingSet: filter.ratings.length > 0 ? new Set(filter.ratings) : null,
    flagSet: filter.flags.length > 0 ? new Set(filter.flags) : null,
    labelSet: filter.labels.length > 0 ? new Set(filter.labels) : null,
    kindSet: filter.kinds.length > 0 ? new Set(filter.kinds) : null,
    albumIDSet: filter.albumIDs.length > 0 ? new Set(filter.albumIDs) : null,
    keywordSet: filter.keywords.length > 0 ? new Set(filter.keywords) : null,
    yearFrom: filter.yearFrom === null ? null : new Date(filter.yearFrom, 0, 1).getTime(),
    yearTo: filter.yearTo === null ? null : new Date(filter.yearTo + 1, 0, 1).getTime()
  }
}

/** 单个条件是否命中。`context` 由调用方一次性建好（`findViewRows`）。 */
function matchesFilter(
  row: GalleryRow,
  filter: GalleryFilterState,
  context?: MatchContext
): boolean {
  const ctx = context ?? createMatchContext(filter)
  if (!filter.includeHidden && row.hidden) return false
  if (filter.onlyMissing && !row.missing) return false
  if (filter.searchIDs) {
    if (ctx.searchSet) {
      if (!ctx.searchSet.has(row.id)) return false
    } else if (!filter.searchIDs.includes(row.id)) {
      return false
    }
  }
  if (ctx.ratingSet && !ctx.ratingSet.has(row.rating)) return false
  if (filter.minRating !== null && row.rating < filter.minRating) return false
  if (ctx.flagSet) {
    if (row.flag === null || !ctx.flagSet.has(row.flag)) return false
  }
  if (ctx.labelSet) {
    if (row.label === null || !ctx.labelSet.has(row.label)) return false
  }
  if (ctx.kindSet && !ctx.kindSet.has(row.kind)) return false
  // 年份用毫秒区间比较：旧实现在每行上 `new Date(...).getFullYear()`，
  // 5 万行筛选一次就是 5 万个 Date 对象。
  if (ctx.yearFrom !== null && row.capturedAt < ctx.yearFrom) return false
  if (ctx.yearTo !== null && row.capturedAt >= ctx.yearTo) return false
  const albumIDSet = ctx.albumIDSet
  if (albumIDSet && !row.albumIDs.some((id) => albumIDSet.has(id))) return false
  // 关键词直接在 catalog 行上比对（行里现在带有 keywords）。
  // 旧实现要求外部传入 keywordIDs，而这个参数从未被传过 —— 选关键词 chip 会得到空网格。
  const keywordSet = ctx.keywordSet
  if (keywordSet) {
    const hit = row.keywords.some((keyword) => keywordSet.has(`${keyword.facet}:${keyword.value}`))
    if (!hit) return false
  }
  return true
}

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter(function (item) {
        return item !== value
      })
    : [...list, value]
}

function serializeFilter(filter: GalleryFilterState): string {
  const rest: Record<string, unknown> = { ...filter }
  delete rest.searchIDs
  return JSON.stringify({ v: FILTER_SCHEMA_VER, ...rest, hasSearch: filter.searchIDs !== null })
}

/** 解析智能相簿的规则；版本不认识时返回 null（调用方降级成「全部」而不是猜）。 */
function parseFilter(raw: string): GalleryFilterState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<GalleryFilterState> & { v?: number }
    if (parsed.v !== FILTER_SCHEMA_VER) return null
    return { ...createFilter(), ...parsed, searchIDs: null }
  } catch (error) {
    console.warn('[gallery] 智能相簿规则解析失败', error)
    return null
  }
}

export {
  FILTER_SCHEMA_VER,
  createFilter,
  createMatchContext,
  isFilterEmpty,
  matchesFilter,
  parseFilter,
  serializeFilter,
  toggleIn
}
export type { GalleryFilterState, MatchContext }
