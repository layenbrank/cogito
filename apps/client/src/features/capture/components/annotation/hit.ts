import type Konva from 'konva'

import {
  boundsContainsPoint,
  boundsIntersect,
  findGraphicsBounds,
  findKonvaByID,
  findUnionBounds,
  type Bounds
} from '@/features/capture/components/graphics/geometry'
import type { GraphicsProps } from '@/features/capture/components/graphics/types'

/** 自命中节点向上查找 name=annotation 的 Group */
function findAnnotationNode(target: Konva.Node): Konva.Node | null {
  let node: Konva.Node | null = target
  while (node) {
    if (node.name() === 'annotation') return node
    node = node.getParent()
  }
  return null
}

/** 是否点在 Transformer / 裁剪手柄上（这些位置不启动橡皮筋） */
function isMarqueeBlockedTarget(target: Konva.Node): boolean {
  let node: Konva.Node | null = target
  while (node) {
    if (node.getClassName() === 'Transformer') return true
    if (node.name() === 'selection-overlay-layer') return true
    node = node.getParent()
  }
  return false
}

/** 命中是否为当前已选中的标注（已选中则走拖拽，不抢橡皮筋） */
function isSelectedAnnotationTarget(target: Konva.Node, selectedIDs: string[]): boolean {
  const annotation = findAnnotationNode(target)
  if (!annotation) return false
  return selectedIDs.includes(annotation.id())
}

/** 用 Konva 节点真实包围盒做相交（比纯 points AABB 更准） */
function findNodeBounds(stage: Konva.Stage, id: string): Bounds | null {
  const node = findKonvaByID(stage, id)
  if (!node) return null
  const rect = node.getClientRect({ relativeTo: stage })
  if (rect.width <= 0 && rect.height <= 0) return null
  return { x: rect.x, y: rect.y, w: Math.max(rect.width, 1), h: Math.max(rect.height, 1) }
}

/** 右键几何探测：含锁定项（listening=false 时仍可解锁） */
function findAnnotationAtPoint(
  stage: Konva.Stage,
  annotations: GraphicsProps[],
  pt: { x: number; y: number }
): GraphicsProps | null {
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    const annotation = annotations[i]
    if (!annotation) continue
    const bounds = findNodeBounds(stage, annotation.id) ?? findGraphicsBounds(annotation)
    if (bounds && boundsContainsPoint(bounds, pt.x, pt.y)) {
      return annotation
    }
  }
  return null
}

function clampPointToClip(
  pt: { x: number; y: number },
  clip: { x: number; y: number; w: number; h: number } | null
): { x: number; y: number } {
  if (!clip || clip.w <= 0 || clip.h <= 0) return pt
  return {
    x: Math.max(clip.x, Math.min(pt.x, clip.x + clip.w)),
    y: Math.max(clip.y, Math.min(pt.y, clip.y + clip.h))
  }
}

function findSelectedUnionBounds(
  annotations: GraphicsProps[],
  selectedIDs: string[],
  stage?: Konva.Stage | null
): Bounds | null {
  const idSet = new Set(selectedIDs)
  const boxes: Bounds[] = []
  for (const annotation of annotations) {
    if (!idSet.has(annotation.id)) continue
    const box =
      (stage ? findNodeBounds(stage, annotation.id) : null) ?? findGraphicsBounds(annotation)
    if (box) boxes.push(box)
  }
  return findUnionBounds(boxes)
}

/** 橡皮筋命中：输出原始命中 id（含缝隙：并集相交则推入该组任一成员）；整组展开由 expandSelectionIDs 负责 */
function findMarqueeHitIDs(
  annotations: GraphicsProps[],
  box: Bounds,
  stage: Konva.Stage | null
): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const groupBoxes = new Map<string, Bounds[]>()

  function pushID(id: string) {
    if (seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }

  for (const annotation of annotations) {
    if (annotation.locked) continue
    const bounds =
      (stage ? findNodeBounds(stage, annotation.id) : null) ?? findGraphicsBounds(annotation)
    if (!bounds) continue
    if (annotation.groupID) {
      const list = groupBoxes.get(annotation.groupID) ?? []
      list.push(bounds)
      groupBoxes.set(annotation.groupID, list)
    }
    if (boundsIntersect(bounds, box)) pushID(annotation.id)
  }

  groupBoxes.forEach(function (boxes, groupID) {
    const union = findUnionBounds(boxes)
    if (!union || !boundsIntersect(union, box)) return
    const already = annotations.some(function (annotation) {
      return annotation.groupID === groupID && seen.has(annotation.id)
    })
    if (already) return
    for (const annotation of annotations) {
      if (annotation.locked || annotation.groupID !== groupID) continue
      pushID(annotation.id)
      return
    }
  })

  return ids
}

export {
  clampPointToClip,
  findAnnotationAtPoint,
  findAnnotationNode,
  findMarqueeHitIDs,
  findNodeBounds,
  findSelectedUnionBounds,
  isMarqueeBlockedTarget,
  isSelectedAnnotationTarget
}
