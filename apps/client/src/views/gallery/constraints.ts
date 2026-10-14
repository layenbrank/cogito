/**
 * 竞品调研锁定的产品约束（Apple / Google / Samsung / Windows / Immich）。
 * UI 与数据层实现须遵守，勿在未改方案前放宽。
 */

/** 底栏双区 IA（对齐 iOS 26 Photos） */
const GALLERY_TABS = ['library', 'collections'] as const

type GalleryTab = (typeof GALLERY_TABS)[number]

/** Library 内布局：默认密集网格；轴式为第二展示 */
const LIBRARY_LAYOUTS = ['grid', 'axis'] as const

type LibraryLayout = (typeof LIBRARY_LAYOUTS)[number]

/** 时间粒度（Years / Months / All） */
const TIME_SCOPES = ['years', 'months', 'all'] as const

type TimeScope = (typeof TIME_SCOPES)[number]

/** 主库与搜索默认排除 hidden（Google Locked Folder 语义） */
const IS_HIDDEN_EXCLUDED = true

/** Vault 仅会话解锁；关窗后需再 PIN */
const IS_VAULT_SESSION_ONLY = true

/** v1 不做回忆 / 人脸 / 云同步 / 自定义相簿 / 假隐藏 */
const V1_OMITTED = [
  'memories',
  'faces',
  'cloud-sync',
  'custom-albums',
  'soft-hide-albums-only'
] as const

const MEDIA_KINDS = ['image', 'video'] as const

type MediaKind = (typeof MEDIA_KINDS)[number]

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'avif'] as const
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'] as const

const GRID_ZOOM_LEVELS = [3, 4, 5, 6, 7] as const

const PIN_MIN_LENGTH = 4
const PIN_MAX_LENGTH = 8

const FUSE_THRESHOLD = 0.35

const MOTION_MS = 220

/**
 * 大量媒体性能策略（v1）：
 * 1. CSS `content-visibility: auto` — 跳过屏外绘制（与 studio StreamedGrid 一致）
 * 2. 分片挂载 day/section — 首屏先露，空闲补齐
 * 3. IntersectionObserver 延后绑定 src — 尤其避免全量 `<video preload=metadata>`
 * 4. Lightbox 已用 Swiper Virtual；缩略条只渲染活跃窗口
 * 未引入 @tanstack/react-virtual：栅格按日分桶 + sticky 头，与绝对定位虚拟行冲突大；
 * 万级后再评估按「行」虚拟化。
 */
const STREAM_SECTION_CHUNK = 10
const NEAR_VIEWPORT_MARGIN = '280px'
const LIGHTBOX_THUMB_WINDOW = 32
const LIGHTBOX_ZOOM_MIN = 1
const LIGHTBOX_ZOOM_MAX = 5
const LIGHTBOX_ZOOM_STEP = 0.12
/** 预览窗固定宽高比（随窗口缩放，不跟图片） */
const LIGHTBOX_FRAME_ASPECT = 16 / 10

export {
  FUSE_THRESHOLD,
  GALLERY_TABS,
  GRID_ZOOM_LEVELS,
  IMAGE_EXTENSIONS,
  IS_HIDDEN_EXCLUDED,
  IS_VAULT_SESSION_ONLY,
  LIBRARY_LAYOUTS,
  LIGHTBOX_FRAME_ASPECT,
  LIGHTBOX_THUMB_WINDOW,
  LIGHTBOX_ZOOM_MAX,
  LIGHTBOX_ZOOM_MIN,
  LIGHTBOX_ZOOM_STEP,
  MEDIA_KINDS,
  MOTION_MS,
  NEAR_VIEWPORT_MARGIN,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  STREAM_SECTION_CHUNK,
  TIME_SCOPES,
  V1_OMITTED,
  VIDEO_EXTENSIONS
}

export type { GalleryTab, LibraryLayout, MediaKind, TimeScope }
