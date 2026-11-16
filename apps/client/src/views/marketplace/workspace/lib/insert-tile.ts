import type { MagneticTileWrite } from '@/stores/mirror.ts'

import { parseTileWrite } from '@/views/marketplace/workspace/customize/tile-io'

type TileWriteOverrides = {
  size?: Mirror.Size
  shape?: Mirror.Shape
  direction?: Mirror.Direction
}

type InsertTileOptions = {
  tile: MagneticTile
  mirrorID: string
  overrides?: TileWriteOverrides
  toInsertMagneticTile: (writes: MagneticTileWrite[]) => Promise<string[]>
}

/** 在 tile-io 的基础写入上覆盖尺寸 / 形状 / 方向 */
function buildTileWrite(
  tile: MagneticTile,
  mirrorID: string,
  overrides?: TileWriteOverrides
): MagneticTileWrite {
  const write = parseTileWrite(tile, mirrorID)
  if (!overrides) return write

  return {
    ...write,
    size: overrides.size ?? write.size,
    shape: overrides.shape ?? write.shape,
    direction: overrides.direction ?? write.direction
  }
}

/**
 * 把一块（来自商店 / 导航的）磁贴追加到墙上。
 *
 * index 由后端分配（`MAX(index) + 1`，同一事务内），这里只负责把 `MagneticTile` 翻成写入体。
 */
function insertTile(options: InsertTileOptions): Promise<string[]> {
  return options.toInsertMagneticTile([
    buildTileWrite(options.tile, options.mirrorID, options.overrides)
  ])
}

export { insertTile }
export type { InsertTileOptions, TileWriteOverrides }
