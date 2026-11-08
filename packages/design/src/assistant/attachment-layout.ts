/**
 * 附件预览的几何：缩略图外框 + 灯箱里的 contain 尺寸 / 缩放 / 平移。
 *
 * 口径与图库预览（`apps/client/src/lib/canvas` 的 viewport）一致：
 * 100% = 按外框 contain 之后的尺寸，滚轮以指针为锚，最大 8 倍。
 * 放在设计系统里是因为缩略图和灯箱都在 `packages/design`，不能反向依赖 app。
 */

interface Size {
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

interface Viewport {
  scale: number
  x: number
  y: number
}

/** 相对 contain 尺寸的最大放大倍数 */
const VIEWPORT_ZOOM_MAX = 8
/** 滚轮每一档的倍率 */
const VIEWPORT_WHEEL_FACTOR = 1.08

function isValidSize(size: Size | null | undefined): size is Size {
  return Boolean(size && size.width > 0 && size.height > 0)
}

/**
 * 内容在外框里 contain 之后的大小：取宽高缩放比里小的那个，天然比例不变。
 */
function containSize(bounds: Size, content: Size): Size {
  if (!isValidSize(bounds) || !isValidSize(content)) return { width: 0, height: 0 }
  const ratio = Math.min(bounds.width / content.width, bounds.height / content.height)
  return { width: content.width * ratio, height: content.height * ratio }
}

interface AttachmentTileLimits {
  /** 缩略图高度（固定，横向由比例决定） */
  height: number
  /** 超过这个宽度就不再变宽，改用 contain 留白 */
  maxWidth: number
  /** 低于这个宽度就留白（默认正方形：竖图不再比原来更窄） */
  minWidth?: number
}

/**
 * 缩略图外框：高度固定、宽度跟着图片比例走，超宽 / 超窄时钳到边界。
 *
 * 图还没解码出来（`natural` 为空）时给正方形占位，加载完再按真实比例展开。
 */
function findAttachmentTileSize(natural: Size | null, limits: AttachmentTileLimits): Size {
  const height = Math.max(1, Math.round(limits.height))
  const minWidth = Math.max(1, Math.round(limits.minWidth ?? height))
  const maxWidth = Math.max(minWidth, Math.round(limits.maxWidth))
  if (!isValidSize(natural)) return { width: height, height }
  const width = Math.round((natural.width / natural.height) * height)
  return { width: Math.min(maxWidth, Math.max(minWidth, width)), height }
}

/** 100% 的视口：内容 contain 后居中 */
function fitViewport(bounds: Size, content: Size): Viewport {
  const fit = containSize(bounds, content)
  return {
    scale: 1,
    x: (bounds.width - fit.width) / 2,
    y: (bounds.height - fit.height) / 2
  }
}

/** 小于外框时居中；大于外框时不允许把画面完全拖出 */
function clampPan(viewport: Viewport, bounds: Size, content: Size): Viewport {
  const fit = containSize(bounds, content)
  const drawnW = fit.width * viewport.scale
  const drawnH = fit.height * viewport.scale
  let x = viewport.x
  let y = viewport.y
  if (drawnW <= bounds.width) {
    x = (bounds.width - drawnW) / 2
  } else {
    x = Math.min(0, Math.max(bounds.width - drawnW, x))
  }
  if (drawnH <= bounds.height) {
    y = (bounds.height - drawnH) / 2
  } else {
    y = Math.min(0, Math.max(bounds.height - drawnH, y))
  }
  return { scale: viewport.scale, x, y }
}

/**
 * 以指针为锚缩放。`scale` 是相对 contain 尺寸的倍率，指针坐标与视口同一坐标系。
 */
function zoomAtPointer(
  viewport: Viewport,
  pointer: Point,
  factor: number,
  maxScale = VIEWPORT_ZOOM_MAX
): Viewport {
  const oldScale = viewport.scale > 0 ? viewport.scale : 1
  const nextScale = Math.min(maxScale, Math.max(1, oldScale * factor))
  const contentX = (pointer.x - viewport.x) / oldScale
  const contentY = (pointer.y - viewport.y) / oldScale
  return {
    scale: nextScale,
    x: pointer.x - contentX * nextScale,
    y: pointer.y - contentY * nextScale
  }
}

/** 以视口中心为锚缩放（给 +/− 按钮用） */
function zoomAtCenter(viewport: Viewport, bounds: Size, factor: number): Viewport {
  const center = { x: bounds.width / 2, y: bounds.height / 2 }
  return zoomAtPointer(viewport, center, factor)
}

export type { AttachmentTileLimits, Point, Size, Viewport }
export {
  VIEWPORT_WHEEL_FACTOR,
  VIEWPORT_ZOOM_MAX,
  clampPan,
  containSize,
  findAttachmentTileSize,
  fitViewport,
  zoomAtCenter,
  zoomAtPointer
}
