import { v4 as UUID } from 'uuid'

import { type GraphicsProps } from '@/features/capture/components/graphics'

/** 选中集整块上移/下移一层（保持相对顺序） */
function moveAnnotationsLayer(
  annotations: GraphicsProps[],
  ids: string[],
  direction: 'up' | 'down'
): GraphicsProps[] | null {
  if (ids.length === 0) return null
  const idSet = new Set(ids)
  const prev = annotations
  const indices = ids
    .map(function (id) {
      return prev.findIndex(function (a) {
        return a.id === id
      })
    })
    .filter(function (index) {
      return index >= 0
    })
    .sort(function (a, b) {
      return a - b
    })
  if (indices.length === 0) return null
  const next = prev.slice()
  if (direction === 'up') {
    const top = indices[indices.length - 1]
    if (top === undefined || top >= next.length - 1) return null
    for (let i = indices.length - 1; i >= 0; i -= 1) {
      const index = indices[i]
      if (index === undefined || index >= next.length - 1) continue
      const above = next[index + 1]
      if (!above || idSet.has(above.id)) continue
      const current = next[index]
      if (!current) continue
      next[index] = above
      next[index + 1] = current
    }
  } else {
    const bottom = indices[0]
    if (bottom === undefined || bottom <= 0) return null
    for (let i = 0; i < indices.length; i += 1) {
      const index = indices[i]
      if (index === undefined || index <= 0) continue
      const below = next[index - 1]
      if (!below || idSet.has(below.id)) continue
      const current = next[index]
      if (!current) continue
      next[index] = below
      next[index - 1] = current
    }
  }
  return next
}

/** 批量锁定/解锁：选中集中有未锁则全部锁，否则全部解锁 */
function toggleAnnotationsLock(
  annotations: GraphicsProps[],
  ids: string[]
): { next: GraphicsProps[]; nextLocked: boolean } | null {
  if (ids.length === 0) return null
  const idSet = new Set(ids)
  const hasUnlocked = annotations.some(function (a) {
    return idSet.has(a.id) && !a.locked
  })
  const nextLocked = hasUnlocked
  const next = annotations.map(function (a) {
    return idSet.has(a.id) ? { ...a, locked: nextLocked } : a
  })
  return { next, nextLocked }
}

function groupAnnotations(annotations: GraphicsProps[], ids: string[]): GraphicsProps[] | null {
  if (ids.length < 2) return null
  const groupID = UUID()
  const idSet = new Set(ids)
  return annotations.map(function (a) {
    return idSet.has(a.id) ? { ...a, groupID } : a
  })
}

function ungroupAnnotations(annotations: GraphicsProps[], groupID: string): GraphicsProps[] {
  return annotations.map(function (a) {
    return a.groupID === groupID ? { ...a, groupID: undefined } : a
  })
}

/** 复制选中标注到画布（新 id，轻偏移；同组关系保留为新 groupID） */
function copyAnnotations(
  annotations: GraphicsProps[],
  ids: string[]
): { next: GraphicsProps[]; cloneIDs: string[] } | null {
  if (ids.length === 0) return null
  const idSet = new Set(ids)
  const OFFSET = 12
  const groupMap = new Map<string, string>()
  const sources = annotations.filter(function (a) {
    return idSet.has(a.id)
  })
  if (sources.length === 0) return null

  const clones: GraphicsProps[] = sources.map(function (source) {
    let nextGroupID = source.groupID
    if (source.groupID) {
      let mapped = groupMap.get(source.groupID)
      if (!mapped) {
        mapped = UUID()
        groupMap.set(source.groupID, mapped)
      }
      nextGroupID = mapped
    }
    return {
      ...source,
      id: UUID(),
      groupID: nextGroupID,
      locked: false,
      points: source.points.map(function (p) {
        return { x: p.x + OFFSET, y: p.y + OFFSET }
      })
    }
  })

  const cloneIDs = clones.map(function (c) {
    return c.id
  })
  return { next: annotations.concat(clones), cloneIDs }
}

function deleteAnnotations(annotations: GraphicsProps[], ids: string[]): GraphicsProps[] {
  const idSet = new Set(ids)
  return annotations.filter(function (a) {
    return !idSet.has(a.id)
  })
}

export {
  copyAnnotations,
  deleteAnnotations,
  groupAnnotations,
  moveAnnotationsLayer,
  toggleAnnotationsLock,
  ungroupAnnotations
}
