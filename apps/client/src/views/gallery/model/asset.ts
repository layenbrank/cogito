/**
 * 图库的领域类型（与 Rust `cogito_core::gallery::types` 一一对应）。
 *
 * 命名遵循仓库约定：缩略语全大写（`stackID` / `albumIDs`）。
 */

type GalleryKind = 'image' | 'video' | 'other'
type GalleryFlag = 'rejected' | 'picked'
type GalleryLabel = 'red' | 'yellow' | 'green' | 'blue' | 'purple'
type KeywordFacet = 'people' | 'places' | 'themes'

const GALLERY_FLAGS: readonly GalleryFlag[] = ['rejected', 'picked']
const GALLERY_LABELS: readonly GalleryLabel[] = ['red', 'yellow', 'green', 'blue', 'purple']
const KEYWORD_FACETS: readonly KeywordFacet[] = ['people', 'places', 'themes']

/** catalog 行：网格/侧栏/状态栏需要的全部字段（不含 EXIF）。 */
interface GalleryRow {
  id: string
  kind: GalleryKind
  name: string
  path: string
  mime: string
  capturedAt: number
  dateSource: string | null
  rating: number
  flag: GalleryFlag | null
  label: GalleryLabel | null
  size: number | null
  width: number | null
  height: number | null
  durationMs: number | null
  stackID: string | null
  dupGroup: string | null
  missing: boolean
  hidden: boolean
  albumIDs: string[]
  /** 关键词（筛选 chip 与 facet 计数都直接用它，不再单独请求） */
  keywords: GalleryKeyword[]
  source: string | null
  captureKind: string | null
  isManaged: boolean
  keep: boolean
  mtimeMs: number | null
  probed: boolean
}

interface CatalogPayload {
  schemaVer: number
  total: number
  probedCount: number
  rows: GalleryRow[]
}

interface GalleryKeyword {
  facet: KeywordFacet
  value: string
}

/** 详情：检查器与灯箱按需取。 */
interface GalleryDetails {
  id: string
  keywords: GalleryKeyword[]
  albumIDs: string[]
  contentHash: string | null
  mtimeMs: number | null
  sizeBytes: number | null
  width: number | null
  height: number | null
  capturedAt: number | null
  dateSource: string | null
  exif: Record<string, unknown> | null
  gps: { lat?: number; lng?: number } | null
}

interface FacetCount {
  value: string
  count: number
}

interface GalleryFacets {
  total: number
  ratings: FacetCount[]
  labels: FacetCount[]
  flags: FacetCount[]
  kinds: FacetCount[]
  years: FacetCount[]
  albums: FacetCount[]
  keywords: FacetCount[]
}

interface SmartAlbumRow {
  id: string
  name: string
  query: string
  index: number
  createdAt: number
  updatedAt: number
}

interface GalleryRootRow {
  id: string
  path: string
  addedAt: number
  lastScanAt: number | null
  isWatching: boolean
}

interface AlbumCountRow {
  albumID: string
  count: number
}

/** 一次策展 patch：外层 undefined = 不改，null = 清空。 */
interface CuratePatch {
  rating?: number
  flag?: GalleryFlag | null
  label?: GalleryLabel | null
  hidden?: boolean
  keep?: boolean
  keywords?: GalleryKeyword[]
}

interface ImportOutcome {
  imported: number
  skipped: number
  failed: { path: string; reason: string }[]
}

const CATALOG_SCHEMA_VER = 1

export { CATALOG_SCHEMA_VER, GALLERY_FLAGS, GALLERY_LABELS, KEYWORD_FACETS }
export type {
  AlbumCountRow,
  CatalogPayload,
  CuratePatch,
  FacetCount,
  GalleryDetails,
  GalleryFacets,
  GalleryFlag,
  GalleryKind,
  GalleryKeyword,
  GalleryLabel,
  GalleryRootRow,
  GalleryRow,
  ImportOutcome,
  KeywordFacet,
  SmartAlbumRow
}
