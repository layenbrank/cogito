import { create } from 'zustand'

import { createSeedTiles } from '@/services/tileSeed'
import { mmkvStorage } from '@/stores/storage'
import type { MagneticTile, MagneticTileChange } from '@/types/magnetic-tile'

interface TileState {
  tiles: MagneticTile[]
  isHydrated: boolean
  hydrate: (userId: string) => void
  reorder: (orderedIds: string[]) => void
  updateTile: (id: string, change: MagneticTileChange) => void
  clear: () => void
}

function storageKey(userId: string) {
  return `tiles:${userId}`
}

function readTiles(userId: string): MagneticTile[] {
  const raw = mmkvStorage.getItem(storageKey(userId))
  if (!raw) {
    const seeded = createSeedTiles()
    mmkvStorage.setItem(storageKey(userId), JSON.stringify(seeded))
    return seeded
  }
  return JSON.parse(raw) as MagneticTile[]
}

function writeTiles(userId: string, tiles: MagneticTile[]) {
  mmkvStorage.setItem(storageKey(userId), JSON.stringify(tiles))
}

let activeUserId: string | null = null

const useTileStore = create<TileState>((set, get) => ({
  tiles: [],
  isHydrated: false,

  hydrate(userId) {
    activeUserId = userId
    set({ tiles: readTiles(userId), isHydrated: true })
  },

  reorder(orderedIds) {
    const current = get().tiles
    const byId = new Map(current.map((tile) => [tile.id, tile]))
    const reordered = orderedIds
      .map((id) => byId.get(id))
      .filter((tile): tile is MagneticTile => Boolean(tile))
      .map(function (tile, index) {
        return { ...tile, index, updatedAt: Date.now() }
      })
    set({ tiles: reordered })
    if (activeUserId) {
      writeTiles(activeUserId, reordered)
    }
  },

  updateTile(id, change) {
    const tiles = get().tiles.map(function (tile) {
      if (tile.id !== id) {
        return tile
      }
      return { ...tile, ...change, updatedAt: Date.now() }
    })
    set({ tiles })
    if (activeUserId) {
      writeTiles(activeUserId, tiles)
    }
  },

  clear() {
    activeUserId = null
    set({ tiles: [], isHydrated: false })
  }
}))

export { useTileStore }
