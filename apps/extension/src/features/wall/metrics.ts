import { findGridSpan } from '@/features/magnetic-tile/layout.ts'

/** 与桌面端磁贴网格同一套轨道：60px 单元，30px 间距。 */
const TILE_UNIT = 60
const TILE_GAP = 30

interface TileBox {
  columns: number
  rows: number
  width: number
  height: number
}

function findTrackPx(span: number): number {
  const count = Math.max(1, span)
  if (count === 1) return TILE_UNIT
  return count * TILE_UNIT + (count - 1) * TILE_GAP
}

function findTileBox(tile: Pick<MagneticTile, 'size' | 'shape' | 'direction'>): TileBox {
  const span = findGridSpan(tile)
  return {
    columns: span.w,
    rows: span.h,
    width: findTrackPx(span.w),
    height: findTrackPx(span.h)
  }
}

export { TILE_GAP, TILE_UNIT, findTileBox, findTrackPx }
export type { TileBox }
