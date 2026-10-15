/**
 * 画布度量：内容坐标（项目分辨率）与视口 CSS 像素分离；Stage.pixelRatio = dpr。
 */

interface Size {
  width: number
  height: number
}

interface StageMetrics {
  /** 视口 CSS 宽高（Stage width/height） */
  view: Size
  /** 内容逻辑像素（如 1920×1080） */
  content: Size
  dpr: number
  /** 内容适配视口的缩放 */
  scale: number
  /** 内容在视口中的偏移（居中） */
  offsetX: number
  offsetY: number
  pixelRatio: number
}

function findDevicePixelRatio(value?: number): number {
  const raw = value ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1)
  return Math.max(1, raw || 1)
}

function findFitScale(view: Size, content: Size): number {
  if (content.width <= 0 || content.height <= 0) return 1
  if (view.width <= 0 || view.height <= 0) return 1
  return Math.min(view.width / content.width, view.height / content.height)
}

/** 在视口内按内容比例 contain，得到整数 CSS 像素框 */
function findContainSize(view: Size, content: Size): Size {
  const scale = findFitScale(view, content)
  return {
    width: Math.max(1, Math.floor(content.width * scale)),
    height: Math.max(1, Math.floor(content.height * scale))
  }
}

function findStageMetrics(view: Size, content: Size, dpr = findDevicePixelRatio()): StageMetrics {
  const scale = findFitScale(view, content)
  const drawnW = content.width * scale
  const drawnH = content.height * scale
  return {
    view,
    content,
    dpr,
    scale,
    offsetX: (view.width - drawnW) / 2,
    offsetY: (view.height - drawnH) / 2,
    pixelRatio: dpr
  }
}

/** 内容坐标 → 视口坐标 */
function contentToView(
  metrics: StageMetrics,
  point: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: metrics.offsetX + point.x * metrics.scale,
    y: metrics.offsetY + point.y * metrics.scale
  }
}

/** 视口坐标 → 内容坐标 */
function viewToContent(
  metrics: StageMetrics,
  point: { x: number; y: number }
): { x: number; y: number } {
  if (metrics.scale === 0) return { x: 0, y: 0 }
  return {
    x: (point.x - metrics.offsetX) / metrics.scale,
    y: (point.y - metrics.offsetY) / metrics.scale
  }
}

/**
 * 归一化中心点 (0–1) + scale/rotation → 内容空间矩形变换。
 * Clipchamp clip 用中心锚点。
 */
function findCenteredTransform(input: {
  contentWidth: number
  contentHeight: number
  x: number
  y: number
  scale: number
  rotation: number
  /** 媒体固有宽高；缺省铺满内容区 */
  mediaWidth?: number
  mediaHeight?: number
}): {
  x: number
  y: number
  width: number
  height: number
  scaleX: number
  scaleY: number
  rotation: number
  offsetX: number
  offsetY: number
} {
  const mediaW = input.mediaWidth ?? input.contentWidth
  const mediaH = input.mediaHeight ?? input.contentHeight
  const fit = Math.min(input.contentWidth / mediaW, input.contentHeight / mediaH)
  const baseW = mediaW * fit
  const baseH = mediaH * fit
  const cx = input.x * input.contentWidth
  const cy = input.y * input.contentHeight
  return {
    x: cx,
    y: cy,
    width: baseW,
    height: baseH,
    scaleX: input.scale,
    scaleY: input.scale,
    rotation: input.rotation,
    offsetX: baseW / 2,
    offsetY: baseH / 2
  }
}

export type { Size, StageMetrics }
export {
  findDevicePixelRatio,
  findFitScale,
  findContainSize,
  findStageMetrics,
  contentToView,
  viewToContent,
  findCenteredTransform
}
