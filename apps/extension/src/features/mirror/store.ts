import { liveQuery } from 'dexie'
import { create } from 'zustand'

import { database } from '@/database/database.ts'
import { findSiteMark } from '@/features/magnetic-tile/mark.ts'
import { insertNavigation } from './insert.ts'
import type { MagneticTileInput } from './input.ts'
import { seedIfEmpty } from './seed.ts'

/**
 * 镜像 / 磁贴的 React 状态源（替换原 Pinia 的 `stores/mirror.ts`）。
 *
 * Dexie 的 `liveQuery` 负责把库里的变化推回来；这里只做「订阅一次 + 增删改」，
 * 不再维护 Pinia / vueuse 那套响应式。
 */

interface TileLayout {
  size: MagneticTile.Size
  shape: MagneticTile.Shape
  direction: MagneticTile.Direction
}

interface MirrorState {
  isReady: boolean
  mirror: Mirror | null
  tiles: MagneticTile[]
  initialize: () => void
  toAppendTile: (input: MagneticTileInput) => Promise<void>
  toUpdateTile: (id: string, input: MagneticTileInput) => Promise<void>
  toRenameTile: (id: string, title: string) => Promise<void>
  toCreateCollection: (title: string) => Promise<void>
  toAssignCollection: (ids: readonly string[], collectionID: string | null) => Promise<void>
  toChangeLayout: (ids: readonly string[], layout: TileLayout) => Promise<void>
  toRemoveTile: (id: string) => Promise<void>
  toRemoveTiles: (ids: readonly string[]) => Promise<void>
  toReorder: (ids: readonly string[]) => Promise<void>
  toUpdateWallpaper: (image: string | null) => Promise<void>
}

let subscriptionReady = false
let watchedMirrorID: string | null = null
let tilesSubscription: { unsubscribe: () => void } | null = null

export const useMirrorStore = create<MirrorState>(function (set) {
  function watchTiles(mirrorID: string): void {
    if (watchedMirrorID === mirrorID && tilesSubscription) return
    watchedMirrorID = mirrorID
    tilesSubscription?.unsubscribe()
    tilesSubscription = liveQuery(function () {
      return database.magneticTile.where('mirrorID').equals(mirrorID).sortBy('index')
    }).subscribe({
      next: function (tiles) {
        set({
          tiles: tiles.filter(function (tile) {
            return !tile.archivedAt
          })
        })
      },
      error: function (error) {
        console.error('[mirror] 订阅磁贴失败', error)
      }
    })
  }

  return {
    isReady: false,
    mirror: null,
    tiles: [],

    initialize() {
      if (subscriptionReady) return
      subscriptionReady = true

      void seedIfEmpty()

      liveQuery(function () {
        return database.mirror.orderBy('index').toArray()
      }).subscribe({
        next: function (mirrors) {
          const [mirror] = mirrors
          set({ mirror: mirror ?? null, isReady: Boolean(mirror) })
          if (mirror) watchTiles(mirror.id)
          else {
            watchedMirrorID = null
            tilesSubscription?.unsubscribe()
            tilesSubscription = null
            set({ tiles: [] })
          }
        },
        error: function (error) {
          console.error('[mirror] 订阅镜像失败', error)
        }
      })
    },

    async toAppendTile(input) {
      await insertNavigation(input)
    },

    async toUpdateTile(id, input) {
      const url = input.url.trim()
      await database.magneticTile.update(id, {
        title: input.title.trim(),
        url: url || null,
        mark: url ? findSiteMark(url) : null,
        size: input.size,
        shape: input.shape,
        direction: input.direction,
        updatedAt: Date.now()
      })
    },

    async toRenameTile(id, title) {
      const trimmed = title.trim()
      if (!trimmed) return
      await database.magneticTile.update(id, { title: trimmed, updatedAt: Date.now() })
    },

    async toCreateCollection(title) {
      await insertNavigation({
        title,
        url: '',
        size: 2,
        shape: 'square',
        direction: 'horizontal',
        component: 'collection'
      })
    },

    async toAssignCollection(ids, collectionID) {
      const now = Date.now()
      await database.transaction('rw', database.magneticTile, async function () {
        for (const id of ids) {
          const tile = await database.magneticTile.get(id)
          if (!tile || tile.archivedAt) continue
          if (tile.component === 'collection') continue
          if (collectionID && tile.id === collectionID) continue
          await database.magneticTile.update(id, { collectionID, updatedAt: now })
        }
      })
    },

    async toChangeLayout(ids, layout) {
      const now = Date.now()
      await database.transaction('rw', database.magneticTile, async function () {
        for (const id of ids) {
          await database.magneticTile.update(id, { ...layout, updatedAt: now })
        }
      })
    },

    async toRemoveTile(id) {
      await database.magneticTile.delete(id)
    },

    async toRemoveTiles(ids) {
      const unique = [...new Set(ids)]
      if (!unique.length) return
      const removing = new Set(unique)
      const now = Date.now()
      await database.transaction('rw', database.magneticTile, async function () {
        const tiles = await database.magneticTile.toArray()
        for (const tile of tiles) {
          if (tile.collectionID && removing.has(tile.collectionID)) {
            await database.magneticTile.update(tile.id, { collectionID: null, updatedAt: now })
          }
        }
        await database.magneticTile.bulkDelete(unique)
      })
    },

    async toReorder(ids) {
      const now = Date.now()
      await database.transaction('rw', database.magneticTile, async function () {
        for (let index = 0; index < ids.length; index += 1) {
          const id = ids[index]
          if (!id) continue
          await database.magneticTile.update(id, { index, updatedAt: now })
        }
      })
    },

    async toUpdateWallpaper(image) {
      const mirror = await database.mirror.orderBy('index').first()
      if (!mirror) return

      await database.mirror.update(mirror.id, {
        background: image ? { image, size: 'cover', position: 'center' } : null,
        updatedAt: Date.now()
      })
    }
  }
})

export type { MagneticTileInput }
