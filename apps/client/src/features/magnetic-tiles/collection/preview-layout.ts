import { findMarkerBox } from '@/features/magnetic-tile/size'

/**
 * 集合 marker 里的网址预览格。
 *
 * 磁贴像素：方圆 size×size，横矩形 2size×size，竖矩形 size×2size（unit 60 / gap 30）。
 * 预览按这个盒子挑列数和行数，再把方格铺满：多出来的长边吃进间距，而不是留在两侧。
 * 方向决定阅读顺序（横着按行，竖着按列），成员下标顺序不变。
 */

/** 圆形收进内切正方形，角上的格子才不会被圆裁掉 */
const CIRCLE_FRAME = 1 / Math.SQRT2
/** 图标铺满格子；圆形已经收过框，不必再缩小一圈 */
const ICON_SCALE = 1
/** 长边多余空间变成间距，但不超过格子的这个比例，避免图标被扯开 */
const GAP_CAP_RATIO = 0.4

const PAD_RATIO = 0.05
const GAP_RATIO = 0.05
const PAD_MIN = 4
const PAD_MAX = 14
const GAP_MIN = 4
const GAP_MAX = 12
const CIRCLE_PAD_RATIO = 0.035
const CIRCLE_GAP_RATIO = 0.04

/** 空行比少铺两个图标更糟；方块也不要被拉成一条 */
const EMPTY_LINE_PENALTY = 36
const STRIP_PENALTY = 18
const WRONG_AXIS_PENALTY = 50
const SQUARE_BLOCK_PENALTY = 12
const FLOW_PENALTY = 8
const EDGE_LIMIT = 0.08
const EDGE_WEIGHT = 90
const HOLE_WEIGHT = 1.4
const CELL_BIAS = 0.04

interface AxisLimit {
  columns: number
  rows: number
}

interface PreviewInset {
  frameScale: number
  padX: number
  padY: number
  gapX: number
  gapY: number
  iconScale: number
  /** 方格边长（px），和磁贴盒子同一套 unit / gap */
  cell: number
}

interface CollectionPreviewLayout extends PreviewInset {
  columns: number
  rows: number
  /** 横向按行排，纵向按列排 */
  flow: 'row' | 'column'
  /** 实际放进网格的成员数（不超过容量） */
  count: number
}

interface FrameBox {
  w: number
  h: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function roundTenth(value: number) {
  return Math.round(value * 10) / 10
}

function findAxisLimit(
  size: MagneticTile.Size,
  shape: MagneticTile.Shape,
  direction: MagneticTile.Direction
): AxisLimit {
  if (shape !== 'rectangle') {
    const span = size + 1
    return { columns: span, rows: span }
  }

  // 短边 60px 的 size 1 只排一条。size 2–3 用 4×2，方格才能同时贴住 2.1 的宽高比。
  // size 4 升到 6×3，图标不会因为多两列而缩回去。
  if (size === 1) {
    if (direction === 'vertical') return { columns: 1, rows: 4 }
    return { columns: 4, rows: 1 }
  }
  if (size === 4) {
    if (direction === 'vertical') return { columns: 3, rows: 6 }
    return { columns: 6, rows: 3 }
  }
  if (direction === 'vertical') return { columns: 2, rows: 4 }
  return { columns: 4, rows: 2 }
}

function measureInset(
  frame: FrameBox,
  columns: number,
  rows: number,
  shape: MagneticTile.Shape
): PreviewInset {
  const short = Math.min(frame.w, frame.h)
  const isCircle = shape === 'circle'
  const pad = isCircle
    ? Math.max(2, Math.round(short * CIRCLE_PAD_RATIO))
    : clamp(Math.round(short * PAD_RATIO), PAD_MIN, PAD_MAX)
  const gap = isCircle
    ? Math.max(2, Math.round(short * CIRCLE_GAP_RATIO))
    : clamp(Math.round(short * GAP_RATIO), GAP_MIN, GAP_MAX)
  const innerW = frame.w - pad * 2
  const innerH = frame.h - pad * 2
  const slackW = gap * Math.max(0, columns - 1)
  const slackH = gap * Math.max(0, rows - 1)
  const fitted = Math.min((innerW - slackW) / columns, (innerH - slackH) / rows)
  const cell = Math.max(1, Math.floor(fitted))
  const cap = GAP_CAP_RATIO * cell

  let gapX = gap
  let gapY = gap
  let padX = pad
  let padY = pad

  if (columns === 1) {
    padX = roundTenth((frame.w - cell) / 2)
  } else {
    const raw = (innerW - columns * cell) / (columns - 1)
    gapX = roundTenth(Math.min(raw, cap))
    const used = columns * cell + gapX * (columns - 1)
    padX = roundTenth(Math.max(0, (frame.w - used) / 2))
  }

  if (rows === 1) {
    padY = roundTenth((frame.h - cell) / 2)
  } else {
    const raw = (innerH - rows * cell) / (rows - 1)
    gapY = roundTenth(Math.min(raw, cap))
    const used = rows * cell + gapY * (rows - 1)
    padY = roundTenth(Math.max(0, (frame.h - used) / 2))
  }

  return {
    frameScale: isCircle ? CIRCLE_FRAME : 1,
    padX,
    padY,
    gapX,
    gapY,
    iconScale: ICON_SCALE,
    cell
  }
}

function hasEmptyLine(leftover: number, columns: number, rows: number, flow: 'row' | 'column') {
  if (leftover <= 0) return false
  if (flow === 'column') return leftover >= rows
  return leftover >= columns
}

function scoreGrid(
  inset: PreviewInset,
  frame: FrameBox,
  leftover: number,
  columns: number,
  rows: number,
  shape: MagneticTile.Shape,
  direction: MagneticTile.Direction
) {
  const flow = direction === 'vertical' ? 'column' : 'row'
  const gapRatio = Math.max(inset.gapX, inset.gapY) / inset.cell
  let edge = 0
  if (columns > 1) edge = Math.max(edge, inset.padX / frame.w)
  if (rows > 1) edge = Math.max(edge, inset.padY / frame.h)

  let orient = 0
  if (hasEmptyLine(leftover, columns, rows, flow)) orient += EMPTY_LINE_PENALTY
  if (shape === 'rectangle') {
    if (direction === 'horizontal' && columns < rows) orient += WRONG_AXIS_PENALTY
    if (direction === 'vertical' && rows < columns) orient += WRONG_AXIS_PENALTY
    if (columns === rows && columns > 1) orient += SQUARE_BLOCK_PENALTY
  } else {
    const ratio = Math.max(columns, rows) / Math.min(columns, rows)
    if (ratio > 1.51) orient += STRIP_PENALTY
    if (direction === 'vertical' && columns > rows) orient += FLOW_PENALTY
    if (direction !== 'vertical' && rows > columns) orient += FLOW_PENALTY
  }

  const gapPenalty = Math.max(0, gapRatio - 0.42) * 20
  const edgePenalty = Math.max(0, edge - EDGE_LIMIT) * EDGE_WEIGHT
  return leftover * HOLE_WEIGHT + gapPenalty + edgePenalty + orient - inset.cell * CELL_BIAS
}

function findPreviewGrid(
  limit: AxisLimit,
  count: number,
  frame: FrameBox,
  shape: MagneticTile.Shape,
  direction: MagneticTile.Direction
) {
  let bestColumns = 1
  let bestRows = 1
  let bestScore = Number.POSITIVE_INFINITY
  let bestInset = measureInset(frame, 1, 1, shape)

  for (let columns = 1; columns <= limit.columns; columns += 1) {
    for (let rows = 1; rows <= limit.rows; rows += 1) {
      const slots = columns * rows
      if (slots < count) continue
      const inset = measureInset(frame, columns, rows, shape)
      const score = scoreGrid(inset, frame, slots - count, columns, rows, shape, direction)
      if (score < bestScore) {
        bestScore = score
        bestColumns = columns
        bestRows = rows
        bestInset = inset
      }
    }
  }

  return { columns: bestColumns, rows: bestRows, ...bestInset }
}

function findCollectionPreviewLayout(
  size: MagneticTile.Size,
  shape: MagneticTile.Shape,
  direction: MagneticTile.Direction,
  memberCount: number
): CollectionPreviewLayout {
  const flow = direction === 'vertical' ? 'column' : 'row'
  const tile = findMarkerBox({ size, shape, direction })
  const frameScale = shape === 'circle' ? CIRCLE_FRAME : 1
  const frame = { w: tile.w * frameScale, h: tile.h * frameScale }
  const limit = findAxisLimit(size, shape, direction)
  const capacity = limit.columns * limit.rows
  const count = Math.max(0, Math.min(memberCount, capacity))

  if (count === 0) {
    return { columns: 1, rows: 1, flow, count: 0, ...measureInset(frame, 1, 1, shape) }
  }

  return { ...findPreviewGrid(limit, count, frame, shape, direction), flow, count }
}

/** 最大一档磁贴能放下的预览数；缓存按这个上限取，放大后不用再请求 */
function findCollectionPreviewLimit() {
  const shapes: MagneticTile.Shape[] = ['square', 'circle', 'rectangle']
  const directions: MagneticTile.Direction[] = ['horizontal', 'vertical']
  const sizes: MagneticTile.Size[] = [1, 2, 3, 4]
  let limit = 1

  for (const size of sizes) {
    for (const shape of shapes) {
      for (const direction of directions) {
        const layout = findCollectionPreviewLayout(size, shape, direction, 999)
        if (layout.count > limit) limit = layout.count
      }
    }
  }

  return limit
}

export { findCollectionPreviewLayout, findCollectionPreviewLimit }
export type { CollectionPreviewLayout }
