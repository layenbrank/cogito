import { findFitScale, type Size } from '@/lib/canvas/metrics'

/** 相对适应画面的最大放大倍数 */
const VIEWPORT_ZOOM_MAX = 8
const VIEWPORT_WHEEL_FACTOR = 1.08

interface Viewport {
  scale: number
  x: number
  y: number
}

interface ViewportPoint {
  x: number
  y: number
}

function fitViewport(view: Size, content: Size): Viewport {
  const scale = findFitScale(view, content)
  const drawnW = content.width * scale
  const drawnH = content.height * scale
  return {
    scale,
    x: (view.width - drawnW) / 2,
    y: (view.height - drawnH) / 2
  }
}

function findViewportScaleRange(view: Size, content: Size): { min: number; max: number } {
  const min = findFitScale(view, content)
  return { min, max: min * VIEWPORT_ZOOM_MAX }
}

/**
 * 以指针为锚缩放内容组。
 * 指针在舞台坐标里，组的 x/y/scale 把内容像素映到舞台。
 */
function zoomAtPointer(
  viewport: Viewport,
  pointer: ViewportPoint,
  factor: number,
  minScale: number,
  maxScale: number
): Viewport {
  const oldScale = viewport.scale || 1
  const nextScale = Math.min(maxScale, Math.max(minScale, oldScale * factor))
  const contentX = (pointer.x - viewport.x) / oldScale
  const contentY = (pointer.y - viewport.y) / oldScale
  return {
    scale: nextScale,
    x: pointer.x - contentX * nextScale,
    y: pointer.y - contentY * nextScale
  }
}

/** 小于视口时居中；大于视口时不允许把画面完全拖出 */
function clampPan(viewport: Viewport, view: Size, content: Size): Viewport {
  const drawnW = content.width * viewport.scale
  const drawnH = content.height * viewport.scale
  let x = viewport.x
  let y = viewport.y
  if (drawnW <= view.width) {
    x = (view.width - drawnW) / 2
  } else {
    x = Math.min(0, Math.max(view.width - drawnW, x))
  }
  if (drawnH <= view.height) {
    y = (view.height - drawnH) / 2
  } else {
    y = Math.min(0, Math.max(view.height - drawnH, y))
  }
  return { scale: viewport.scale, x, y }
}

export type { Viewport, ViewportPoint }
export {
  VIEWPORT_ZOOM_MAX,
  VIEWPORT_WHEEL_FACTOR,
  fitViewport,
  findViewportScaleRange,
  zoomAtPointer,
  clampPan
}
