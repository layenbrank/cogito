import type Konva from 'konva'

import type { GraphicsProps, Point } from './types'

const INDEX_RADIUS = 14

interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

function transformPoints(
  points: Point[],
  dx: number,
  dy: number,
  sx: number,
  sy: number,
  rotationDeg = 0
): Point[] {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const localDx = dx * cos + dy * sin
  const localDy = -dx * sin + dy * cos
  return points.map(function (p) {
    return { x: localDx + p.x * sx, y: localDy + p.y * sy }
  })
}

/** 绕原点旋转顶点（组合时把成员既有 rotation 烘焙进顶点、归零 rotation） */
function rotatePointsAroundOrigin(points: Point[], rotationDeg: number): Point[] {
  if (!rotationDeg) return points
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return points.map(function (p) {
    return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
  })
}

function bakeTransformSize(node: Konva.Node, props: GraphicsProps): GraphicsProps | null {
  const sx = node.scaleX()
  const sy = node.scaleY()
  const dx = node.x()
  const dy = node.y()
  const rotation = node.rotation()
  const prevRotation = props.rotation ?? 0

  if (sx === 1 && sy === 1 && dx === 0 && dy === 0 && rotation === prevRotation) {
    return null
  }

  node.scale({ x: 1, y: 1 })
  node.position({ x: 0, y: 0 })

  const next: GraphicsProps = {
    ...props,
    points: transformPoints(props.points, dx, dy, sx, sy, rotation),
    rotation
  }

  if (props.type === 'text' && props.width !== null && props.width !== undefined && sx !== 1) {
    next.width = Math.max(20, props.width * Math.abs(sx))
  }

  return next
}

/**
 * 把组合节点的变换烘焙回各成员绝对顶点。
 * 成员 rotation 已在组合时归一为 0，故顶点直接按 `T·R·S·p` 正向变换。
 */
function bakeGroupTransform(node: Konva.Node, members: GraphicsProps[]): GraphicsProps[] {
  const dx = node.x()
  const dy = node.y()
  const sx = node.scaleX()
  const sy = node.scaleY()
  const rotation = node.rotation()

  if (sx === 1 && sy === 1 && dx === 0 && dy === 0 && rotation === 0) {
    return []
  }

  node.scale({ x: 1, y: 1 })
  node.position({ x: 0, y: 0 })
  node.rotation(0)

  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  return members.map(function (m) {
    const next: GraphicsProps = {
      ...m,
      points: m.points.map(function (p) {
        return {
          x: dx + p.x * sx * cos - p.y * sy * sin,
          y: dy + p.x * sx * sin + p.y * sy * cos
        }
      })
    }
    if (m.type === 'text' && m.width !== null && m.width !== undefined && sx !== 1) {
      next.width = Math.max(20, m.width * Math.abs(sx))
    }
    return next
  })
}

function findKonvaByID(stage: Konva.Stage, id: string): Konva.Node | null {
  const nodes = stage.find(function (node: Konva.Node) {
    return node.id() === id
  })
  return nodes[0] ?? null
}

function findGraphicsBounds(graphics: GraphicsProps): Bounds | null {
  const points = graphics.points
  if (!points.length) return null

  let x = 0
  let y = 0
  let w = 0
  let h = 0

  if (graphics.type === 'text' && points[0]) {
    x = points[0].x
    y = points[0].y
    w = Math.max(graphics.width ?? 80, 8)
    h = Math.max((graphics.fontSize ?? 16) * 1.4, 8)
  } else if (graphics.type === 'index' && points[0]) {
    x = points[0].x - INDEX_RADIUS
    y = points[0].y - INDEX_RADIUS
    w = INDEX_RADIUS * 2
    h = INDEX_RADIUS * 2
  } else {
    const origin = points[0]
    if (!origin) return null
    let minX = origin.x
    let maxX = origin.x
    let minY = origin.y
    let maxY = origin.y
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i]
      if (!point) continue
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, point.y)
      maxY = Math.max(maxY, point.y)
    }
    const pad = Math.max(2, (graphics.thickness ?? 2) / 2)
    x = minX - pad
    y = minY - pad
    w = maxX - minX + pad * 2
    h = maxY - minY + pad * 2
  }

  const rotation = graphics.rotation ?? 0
  if (!rotation) {
    return { x, y, w, h }
  }

  const cx = x + w / 2
  const cy = y + h / 2
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const corners = [
    { x: x, y: y },
    { x: x + w, y: y },
    { x: x + w, y: y + h },
    { x: x, y: y + h }
  ]
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const corner of corners) {
    const dx = corner.x - cx
    const dy = corner.y - cy
    const rx = cx + dx * cos - dy * sin
    const ry = cy + dx * sin + dy * cos
    minX = Math.min(minX, rx)
    maxX = Math.max(maxX, rx)
    minY = Math.min(minY, ry)
    maxY = Math.max(maxY, ry)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function boundsContainsPoint(bounds: Bounds, px: number, py: number): boolean {
  return (
    px >= bounds.x && px <= bounds.x + bounds.w && py >= bounds.y && py <= bounds.y + bounds.h
  )
}

function findUnionBounds(bounds: Bounds[]): Bounds | null {
  const first = bounds[0]
  if (!first) return null
  let minX = first.x
  let minY = first.y
  let maxX = first.x + first.w
  let maxY = first.y + first.h
  for (let i = 1; i < bounds.length; i += 1) {
    const next = bounds[i]
    if (!next) continue
    minX = Math.min(minX, next.x)
    minY = Math.min(minY, next.y)
    maxX = Math.max(maxX, next.x + next.w)
    maxY = Math.max(maxY, next.y + next.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export type { Bounds }
export {
  bakeGroupTransform,
  bakeTransformSize,
  boundsContainsPoint,
  boundsIntersect,
  findGraphicsBounds,
  findKonvaByID,
  findUnionBounds,
  rotatePointsAroundOrigin,
  transformPoints
}
