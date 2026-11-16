/**
 * 灵动岛的几何：吸附判定 / 贴边位置 / 相对坐标。
 *
 * 纯函数，便于覆盖「靠近哪条边」「贴边后露多少」这类边界，不用起窗口。
 */

type IslandEdge = 'top' | 'bottom' | 'left' | 'right'

interface IslandSize {
  width: number
  height: number
}

interface IslandViewport {
  width: number
  height: number
}

interface IslandPoint {
  x: number
  y: number
}

/** 松手时离边多近就吸附（像素） */
const SNAP_DISTANCE = 32
/** 贴边后仍露在屏内的一小截（相对岛尺寸） */
const DOCK_VISIBLE_RATIO = 0.45
/** 自由态与屏边的最小间距 */
const SCREEN_MARGIN = 8

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/** 松手位置 → 最近的边；超过阈值返回 null（自由态） */
function findNearestEdge(
  point: IslandPoint,
  size: IslandSize,
  viewport: IslandViewport
): IslandEdge | null {
  const distances: { edge: IslandEdge; distance: number }[] = [
    { edge: 'top', distance: point.y },
    { edge: 'bottom', distance: viewport.height - (point.y + size.height) },
    { edge: 'left', distance: point.x },
    { edge: 'right', distance: viewport.width - (point.x + size.width) }
  ]
  let best = distances[0]
  for (const item of distances) {
    if (item.distance < best.distance) best = item
  }
  return best.distance <= SNAP_DISTANCE ? best.edge : null
}

/** 收进屏内（自由态） */
function clampIslandPoint(
  point: IslandPoint,
  size: IslandSize,
  viewport: IslandViewport
): IslandPoint {
  return {
    x: clamp(point.x, SCREEN_MARGIN, viewport.width - size.width - SCREEN_MARGIN),
    y: clamp(point.y, SCREEN_MARGIN, viewport.height - size.height - SCREEN_MARGIN)
  }
}

/**
 * 贴边位置：沿边方向跟随指针（夹在屏内），垂直方向偏出屏幕只留一截。
 * 只露 45% 是刻意的 —— 看起来像「从屏幕边上探出半个圆」。
 */
function resolveDockPoint(
  edge: IslandEdge,
  point: IslandPoint,
  size: IslandSize,
  viewport: IslandViewport
): IslandPoint {
  const visibleY = Math.round(size.height * DOCK_VISIBLE_RATIO)
  const visibleX = Math.round(size.width * DOCK_VISIBLE_RATIO)
  const slideX = clamp(point.x, SCREEN_MARGIN, viewport.width - size.width - SCREEN_MARGIN)
  const slideY = clamp(point.y, SCREEN_MARGIN, viewport.height - size.height - SCREEN_MARGIN)

  switch (edge) {
    case 'top':
      return { x: slideX, y: -(size.height - visibleY) }
    case 'bottom':
      return { x: slideX, y: viewport.height - visibleY }
    case 'left':
      return { x: -(size.width - visibleX), y: slideY }
    case 'right':
      return { x: viewport.width - visibleX, y: slideY }
  }
}

/** 展开朝向：左右边纵向、上下边与自由态横向 */
function findIslandOrientation(edge: IslandEdge | null): 'horizontal' | 'vertical' {
  return edge === 'left' || edge === 'right' ? 'vertical' : 'horizontal'
}

/** 结果面板优先往「空间大的一侧」弹 */
function findResultsPlacement(point: IslandPoint, size: IslandSize, viewport: IslandViewport) {
  return point.y + size.height / 2 > viewport.height / 2 ? 'above' : 'below'
}

function toRatio(point: IslandPoint, viewport: IslandViewport): { ratioX: number; ratioY: number } {
  return {
    ratioX: clamp(point.x / Math.max(viewport.width, 1), 0, 1),
    ratioY: clamp(point.y / Math.max(viewport.height, 1), 0, 1)
  }
}

function fromRatio(ratioX: number, ratioY: number, viewport: IslandViewport): IslandPoint {
  return { x: ratioX * viewport.width, y: ratioY * viewport.height }
}

export {
  clamp,
  clampIslandPoint,
  DOCK_VISIBLE_RATIO,
  findIslandOrientation,
  findNearestEdge,
  findResultsPlacement,
  fromRatio,
  resolveDockPoint,
  SCREEN_MARGIN,
  SNAP_DISTANCE,
  toRatio
}
export type { IslandEdge, IslandPoint, IslandSize, IslandViewport }
