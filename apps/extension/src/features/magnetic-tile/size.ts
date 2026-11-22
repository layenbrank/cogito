/** 网格基元 / 间距，与 CSS --magnetic-tile-unit / gap 一致 */
const TILE_UNIT = 60
const TILE_GAP = 30

/** track(n) = unit * n + gap * (n - 1) */
function findTrackPx(span: number) {
  if (span <= 1) return TILE_UNIT
  return span * TILE_UNIT + (span - 1) * TILE_GAP
}

/** 短边像素：size k → k×k 轨道边长 */
const SIZE_PX: Record<Mirror.Size, number> = {
  1: findTrackPx(1),
  2: findTrackPx(2),
  3: findTrackPx(3),
  4: findTrackPx(4)
  // 5: findTrackPx(5),
  // 6: findTrackPx(6),
  // 7: findTrackPx(7)
}

const LAYOUT_FALLBACK = {
  size: 1 as Mirror.Size,
  shape: 'rectangle' as Mirror.Shape,
  direction: 'horizontal' as Mirror.Direction
}

interface MarkerLayout {
  size: Mirror.Size
  shape: Mirror.Shape
  direction: Mirror.Direction
}

interface MarkerBox {
  w: number
  h: number
}

function findMarkerBox(layout: Partial<MarkerLayout> = {}): MarkerBox {
  const size = layout.size ?? LAYOUT_FALLBACK.size
  const shape = layout.shape ?? LAYOUT_FALLBACK.shape
  const direction = layout.direction ?? LAYOUT_FALLBACK.direction

  if (shape === 'rectangle') {
    if (direction === 'horizontal') {
      return { w: findTrackPx(size * 2), h: findTrackPx(size) }
    }
    return { w: findTrackPx(size), h: findTrackPx(size * 2) }
  }

  const side = findTrackPx(size)
  return { w: side, h: side }
}

function parseMarkerLayout(input?: Partial<MarkerLayout> | null): MarkerLayout {
  return {
    size: input?.size ?? LAYOUT_FALLBACK.size,
    shape: input?.shape ?? LAYOUT_FALLBACK.shape,
    direction: input?.direction ?? LAYOUT_FALLBACK.direction
  }
}

export {
  SIZE_PX,
  TILE_UNIT,
  TILE_GAP,
  LAYOUT_FALLBACK,
  findTrackPx,
  findMarkerBox,
  parseMarkerLayout
}
export type { MarkerLayout, MarkerBox }
