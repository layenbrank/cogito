import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import { CHANNELS } from '@/shared/ipc/channels'
import { buildChange, useGalleryStore } from '@/stores/gallery'
import { parseMeta } from '@/views/gallery/model/media'

interface Album {
  id: string
  name: string
  index: number
  coverAssetID: string | null
  status: string
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

interface AlbumWrite {
  name: string
  index?: number
  coverAssetID?: string | null
  status?: string
}

interface AlbumChange {
  name?: string
  index?: number
  coverAssetID?: string | null
  status?: string
  archivedAt?: number | null
}

interface AlbumStore {
  albums: Album[]
  loaded: boolean
  toReadAlbums: () => Promise<Album[]>
  toWriteAlbum: (value: AlbumWrite) => Promise<string | undefined>
  toUpdateAlbum: (key: string, change: AlbumChange) => Promise<void>
  toRemoveAlbum: (key: string) => Promise<void>
  toAttachAlbum: (assetIDs: string[], albumID: string) => Promise<void>
  toDetachAlbum: (assetIDs: string[], albumID: string) => Promise<void>
}

const useAlbumStore = create<AlbumStore>()(
  devtools(
    immer(function (setter, getter) {
      return {
        albums: [],
        loaded: false,

        async toReadAlbums() {
          try {
            const albums = await invoke<Album[]>(CHANNELS.ALBUM.READ, {
              params: {}
            })
            setter(
              function (state) {
                state.albums = albums
                state.loaded = true
              },
              false,
              'toReadAlbums'
            )
            return albums
          } catch (error) {
            console.error('[album-store] toReadAlbums failed:', error)
            setter(
              function (state) {
                state.loaded = true
              },
              false,
              'toReadAlbums/error'
            )
            return []
          }
        },

        async toWriteAlbum(value) {
          try {
            const ids = await invoke<string[]>(CHANNELS.ALBUM.WRITE, {
              params: {
                name: value.name,
                index: value.index ?? getter().albums.length,
                coverAssetID: value.coverAssetID ?? null,
                status: value.status ?? '001'
              }
            })
            await getter().toReadAlbums()
            return ids[0]
          } catch (error) {
            console.error('[album-store] toWriteAlbum failed:', error)
            return undefined
          }
        },

        async toUpdateAlbum(key, change) {
          try {
            await invoke(CHANNELS.ALBUM.UPDATE, {
              params: { key, change }
            })
            await getter().toReadAlbums()
          } catch (error) {
            console.error('[album-store] toUpdateAlbum failed:', error)
          }
        },

        async toRemoveAlbum(key) {
          try {
            await invoke(CHANNELS.ALBUM.REMOVE, { params: key })
            await getter().toReadAlbums()
          } catch (error) {
            console.error('[album-store] toRemoveAlbum failed:', error)
          }
        },

        async toAttachAlbum(assetIDs, albumID) {
          if (assetIDs.length === 0) return
          const medias = useGalleryStore.getState().medias
          const idSet = new Set(assetIDs)
          const targets = medias.filter(function (media) {
            return idSet.has(media.asset.id)
          })
          if (targets.length === 0) return

          const updates = targets.map(function (media) {
            const albums = new Set(parseMeta(media.asset.metadata).albums ?? [])
            albums.add(albumID)
            return {
              id: media.asset.id,
              updates: buildChange(media.asset, { albums: Array.from(albums) })
            }
          })

          await invoke(CHANNELS.ASSET.UPDATE, {
            params: updates.length === 1 ? updates[0] : updates
          })
          await useGalleryStore.getState().toReadMedias({ skipHydrate: true })
        },

        async toDetachAlbum(assetIDs, albumID) {
          if (assetIDs.length === 0) return
          const medias = useGalleryStore.getState().medias
          const idSet = new Set(assetIDs)
          const targets = medias.filter(function (media) {
            return idSet.has(media.asset.id)
          })
          if (targets.length === 0) return

          const updates = targets.map(function (media) {
            const albums = (parseMeta(media.asset.metadata).albums ?? []).filter(function (id) {
              return id !== albumID
            })
            return {
              id: media.asset.id,
              updates: buildChange(media.asset, { albums })
            }
          })

          await invoke(CHANNELS.ASSET.UPDATE, {
            params: updates.length === 1 ? updates[0] : updates
          })
          await useGalleryStore.getState().toReadMedias({ skipHydrate: true })
        }
      }
    }),
    { name: 'album-store' }
  )
)

export { useAlbumStore }
export type { Album, AlbumChange, AlbumWrite }
