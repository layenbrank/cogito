import { invoke } from '@tauri-apps/api/core'
import { CHANNELS } from '@/shared/ipc/channels'

import { parseTileWrite } from '@/views/marketplace/workspace/customize/tile-io'
import type { MagneticTileWrite } from '@/stores/mirror.ts'

type TileWriteOverrides = {
  size?: Mirror.Size
  shape?: Mirror.Shape
  direction?: Mirror.Direction
}

type InsertTileOptions = {
  tile: MagneticTile
  mirrorID: string
  overrides?: TileWriteOverrides
  toInsertMagneticTile: (writes: MagneticTileWrite[]) => Promise<void>
}

/** 同一镜像串行写入，避免连点撞 index */
const insertTails = new Map<string, Promise<unknown>>()

/** 目标镜像当前最大 index + 1 */
async function findNextIndex(mirrorID: string) {
  const tiles = await invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
    params: { mirrorID }
  })
  let max = -1
  for (const tile of tiles) {
    if (typeof tile.index === 'number' && tile.index > max) max = tile.index
  }
  return max + 1
}

function parseTileWrite(
  tile: MagneticTile,
  mirrorID: string,
  index: number,
  overrides?: TileWriteOverrides
): MagneticTileWrite {
  const write = parseTileWrite(tile, mirrorID, index)
  if (!overrides) return write

  return {
    ...write,
    size: overrides.size ?? write.size,
    shape: overrides.shape ?? write.shape,
    direction: overrides.direction ?? write.direction
  }
}

async function runInsert(options: InsertTileOptions) {
  const index = await findNextIndex(options.mirrorID)
  const write = parseTileWrite(options.tile, options.mirrorID, index, options.overrides)
  await options.toInsertMagneticTile([write])
}

/** 按目标镜像计算 index 后写入（同镜像排队） */
async function insertTile(options: InsertTileOptions) {
  const mirrorID = options.mirrorID
  const prev = insertTails.get(mirrorID) ?? Promise.resolve()
  const next = prev.then(
    function () {
      return runInsert(options)
    },
    function () {
      return runInsert(options)
    }
  )
  insertTails.set(mirrorID, next)

  try {
    await next
  } finally {
    if (insertTails.get(mirrorID) === next) {
      insertTails.delete(mirrorID)
    }
  }
}

export { findNextIndex, insertTile, parseTileWrite }
export type { InsertTileOptions, TileWriteOverrides }
