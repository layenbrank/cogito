import { type GraphicsEnum, type GraphicsProps } from '@/features/capture/components/graphics'

interface Point {
  x: number
  y: number
}

/** 创建/拖动判定为「有效」的最小像素距离，低于该值视为误操作并丢弃 */
const MIN_DRAG_PX = 3

/** 单点创建型标注（点击即可），不受拖拽阈值限制 */
const POINT_SHAPES = new Set<GraphicsEnum>(['text', 'index'])

/** 多点追加型标注（拖拽路径上不断 append 点）：画笔、荧光笔 */
const MULTI_POINT_GRAPHICS = new Set<GraphicsEnum>(['freehand', 'highlight'])

/** 按住 Shift 时约束为正方形 / 正圆包围盒 */
const RATIO_GRAPHICS = new Set<GraphicsEnum>(['rect', 'ellipse'])

/** 把命中的 id 按 groupID 并集展开（同组成员全部进入选中集） */
function expandSelectionIDs(ids: string[], list: GraphicsProps[]): string[] {
  const byId = new Map(
    list.map(function (annotation) {
      return [annotation.id, annotation] as const
    })
  )
  const result: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    const item = byId.get(id)
    if (!item) continue
    if (item.groupID) {
      for (const annotation of list) {
        if (annotation.groupID !== item.groupID) continue
        if (seen.has(annotation.id)) continue
        seen.add(annotation.id)
        result.push(annotation.id)
      }
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

/** 从选中集中移除某 id 所属整组（无组则仅移除自身） */
function removeSelectionGroup(selectedIDs: string[], id: string, list: GraphicsProps[]): string[] {
  const item = list.find(function (a) {
    return a.id === id
  })
  if (!item?.groupID) {
    return selectedIDs.filter(function (v) {
      return v !== id
    })
  }
  const groupID = item.groupID
  return selectedIDs.filter(function (v) {
    const annotation = list.find(function (a) {
      return a.id === v
    })
    return annotation?.groupID !== groupID
  })
}

/** Shift：以起点为对角，约束为等宽高（正圆 / 正方形） */
function constrainRatioPoint(origin: Point, pt: Point, shiftKey: boolean): Point {
  if (!shiftKey) return pt
  const dx = pt.x - origin.x
  const dy = pt.y - origin.y
  const size = Math.max(Math.abs(dx), Math.abs(dy))
  const sx = dx === 0 ? (dy >= 0 ? 1 : -1) : Math.sign(dx)
  const sy = dy === 0 ? (dx >= 0 ? 1 : -1) : Math.sign(dy)
  return { x: origin.x + sx * size, y: origin.y + sy * size }
}

function clampPointToSelection(
  pt: Point,
  selection: (Point & { w: number; h: number }) | null
): Point {
  if (!selection) return pt
  return {
    x: Math.max(selection.x, Math.min(pt.x, selection.x + selection.w)),
    y: Math.max(selection.y, Math.min(pt.y, selection.y + selection.h))
  }
}

export type { Point }
export {
  MIN_DRAG_PX,
  MULTI_POINT_GRAPHICS,
  POINT_SHAPES,
  RATIO_GRAPHICS,
  clampPointToSelection,
  constrainRatioPoint,
  expandSelectionIDs,
  removeSelectionGroup
}
