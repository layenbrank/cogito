import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import { invalidateGalleryMarkerThumbs } from '@/features/magnetic-tiles/gallery/preview-cache'
import { CHANNELS } from '@/shared/ipc/channels'
import { reportCaught } from '@/utils/exception-report'
import {
  pickAndImportFiles,
  pickAndImportFolders
} from '@/views/gallery/import-media'
import {
  mergeMeta,
  toGalleryMedia,
  type GalleryAsset,
  type GalleryAssetMeta,
  type GalleryMedia
} from '@/views/gallery/model/media'
import { probeCapturedAt } from '@/views/gallery/model/probe-date'
import {
  hasVaultPin,
  isVaultUnlocked,
  lockVaultSession,
  setupVaultPin,
  unlockVault
} from '@/views/gallery/model/vault'

interface GalleryStore {
  medias: GalleryMedia[]
  loaded: boolean
  importing: boolean
  vaultUnlocked: boolean
  hasPin: boolean
  toReadMedias: (options?: { skipHydrate?: boolean }) => Promise<GalleryMedia[]>
  toImportMedias: (mode?: 'files' | 'folders') => Promise<string[]>
  toHideMedias: (ids: string[], hidden: boolean) => Promise<void>
  toRemoveMedias: (ids: string[]) => Promise<void>
  toSetupPin: (pin: string) => Promise<{ ok: true } | { ok: false; reason: string }>
  toUnlockVault: (pin: string) => Promise<{ ok: true } | { ok: false; reason: string }>
  toLockVault: () => void
  toRefreshVault: () => Promise<void>
}

function mapAssets(assets: GalleryAsset[]): GalleryMedia[] {
  const medias: GalleryMedia[] = []
  for (const asset of assets) {
    const media = toGalleryMedia(asset, convertFileSrc(asset.filePath))
    if (media) medias.push(media)
  }
  return medias
}

function needsDateHydration(media: GalleryMedia): boolean {
  return media.meta.dateSource === undefined && media.meta.source !== 'capture'
}

/** 旧导入数据缺少 dateSource：按 EXIF/文件名/mtime 回填并写回 */
async function hydrateCapturedDates(
  medias: GalleryMedia[],
  persist: (media: GalleryMedia, patch: Partial<GalleryAssetMeta>) => Promise<void>
): Promise<boolean> {
  const stale = medias.filter(needsDateHydration)
  if (stale.length === 0) return false

  let changed = false
  for (const media of stale) {
    try {
      const probed = await probeCapturedAt(media.asset.filePath, media.kind)
      if (probed.at === media.capturedAt && media.meta.dateSource === probed.source) continue
      await persist(media, {
        capturedAt: probed.at,
        dateSource: probed.source
      })
      changed = true
    } catch (error) {
      console.warn('[gallery-store] hydrate date failed:', media.asset.fileName, error)
    }
  }
  return changed
}

function buildChange(asset: GalleryAsset, metaPatch: Partial<GalleryAssetMeta>) {
  return {
    tenantID: asset.tenantID,
    kind: asset.kind,
    hash: asset.hash,
    sha: asset.sha,
    size: asset.size,
    index: asset.index,
    mime: asset.mime,
    extension: asset.extension || '',
    fileName: asset.fileName,
    filePath: asset.filePath,
    metadata: mergeMeta(asset, metaPatch),
    status: asset.status,
    deviceID: asset.deviceID,
    archivedAt: asset.archivedAt
  }
}

const useGalleryStore = create<GalleryStore>()(
  devtools(
    immer(function (setter, getter) {
      return {
        medias: [],
        loaded: false,
        importing: false,
        vaultUnlocked: isVaultUnlocked(),
        hasPin: false,

        async toReadMedias(options) {
          try {
            const assets = await invoke<GalleryAsset[]>(CHANNELS.ASSET.READ, {
              params: {}
            })
            const medias = mapAssets(assets)
            setter(
              function (state) {
                state.medias = medias
                state.loaded = true
              },
              false,
              'toReadMedias'
            )

            if (!options?.skipHydrate) {
              void hydrateCapturedDates(medias, async function (media, patch) {
                await invoke(CHANNELS.ASSET.UPDATE, {
                  params: {
                    id: media.asset.id,
                    updates: buildChange(media.asset, patch)
                  }
                })
              }).then(function (changed) {
                if (changed) void getter().toReadMedias({ skipHydrate: true })
              })
            }

            return medias
          } catch (err) {
            reportCaught('gallery-store.toReadMedias', err)
            setter(
              function (state) {
                state.loaded = true
              },
              false,
              'toReadMedias/error'
            )
            return []
          }
        },

        async toImportMedias(mode = 'files') {
          setter(
            function (state) {
              state.importing = true
            },
            false,
            'toImportMedias/start'
          )
          try {
            const ids =
              mode === 'folders'
                ? await pickAndImportFolders()
                : await pickAndImportFiles()
            if (ids.length > 0) {
              invalidateGalleryMarkerThumbs()
              await getter().toReadMedias()
            }
            return ids
          } finally {
            setter(
              function (state) {
                state.importing = false
              },
              false,
              'toImportMedias/end'
            )
          }
        },

        async toHideMedias(ids, hidden) {
          const { medias } = getter()
          const idSet = new Set(ids)
          const targets = medias.filter(function (media) {
            return idSet.has(media.asset.id)
          })
          if (targets.length === 0) return

          await invoke(CHANNELS.ASSET.UPDATE, {
            params:
              targets.length === 1
                ? {
                    id: targets[0].asset.id,
                    updates: buildChange(targets[0].asset, { hidden })
                  }
                : targets.map(function (media) {
                    return {
                      id: media.asset.id,
                      updates: buildChange(media.asset, { hidden })
                    }
                  })
          })
          invalidateGalleryMarkerThumbs()
          await getter().toReadMedias()
        },

        async toRemoveMedias(ids) {
          if (ids.length === 0) return
          await invoke(CHANNELS.ASSET.REMOVE, {
            params:
              ids.length === 1
                ? { id: ids[0] }
                : ids.map(function (id) {
                    return { id }
                  })
          })
          invalidateGalleryMarkerThumbs()
          await getter().toReadMedias()
        },

        async toSetupPin(pin) {
          const result = await setupVaultPin(pin)
          if (result.ok) {
            setter(
              function (state) {
                state.hasPin = true
                state.vaultUnlocked = true
              },
              false,
              'toSetupPin'
            )
          }
          return result
        },

        async toUnlockVault(pin) {
          const result = await unlockVault(pin)
          if (result.ok) {
            setter(
              function (state) {
                state.vaultUnlocked = true
                state.hasPin = true
              },
              false,
              'toUnlockVault'
            )
          }
          return result
        },

        toLockVault() {
          lockVaultSession()
          setter(
            function (state) {
              state.vaultUnlocked = false
            },
            false,
            'toLockVault'
          )
        },

        async toRefreshVault() {
          const hasPin = await hasVaultPin()
          setter(
            function (state) {
              state.hasPin = hasPin
              state.vaultUnlocked = isVaultUnlocked()
            },
            false,
            'toRefreshVault'
          )
        }
      }
    }),
    { name: 'gallery-store' }
  )
)

export { buildChange, useGalleryStore }
export type { GalleryStore }
