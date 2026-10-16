/**
 * 截屏 / 录屏面板的批量操作：标记保存、删除、复制、另存为、加入/移出相簿。
 *
 * 每个动作都要「现取最新 media 列表再落库」，与渲染无关；抽成 hook 之后面板本体只管工具栏与网格。
 */
import { invoke } from '@tauri-apps/api/core'
import { writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { save as dialogSave } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { toast } from 'sonner'

import { CHANNELS } from '@/shared/ipc/channels'
import { useAlbumStore } from '@/stores/album'
import { buildChange, useGalleryStore } from '@/stores/gallery'
import type { GalleryMedia } from '@/views/gallery/model/media'

interface CaptureActionsOptions {
  /** 当前面板范围内的媒体（复制 / 另存要在这里找目标） */
  scoped: readonly GalleryMedia[]
  selectedIds: Set<string>
  onSelectedIds: (ids: Set<string>) => void
  onSelecting: (value: boolean) => void
}

function useCaptureActions(options: CaptureActionsOptions) {
  const { scoped, selectedIds, onSelectedIds, onSelecting } = options
  const toReadMedias = useGalleryStore(function (state) {
    return state.toReadMedias
  })
  const toAttachAlbum = useAlbumStore(function (state) {
    return state.toAttachAlbum
  })
  const toDetachAlbum = useAlbumStore(function (state) {
    return state.toDetachAlbum
  })

  async function patchKeep(ids: string[], keep: boolean) {
    const medias = useGalleryStore.getState().medias
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
              updates: buildChange(targets[0].asset, { keep })
            }
          : targets.map(function (media) {
              return {
                id: media.asset.id,
                updates: buildChange(media.asset, { keep })
              }
            })
    })
    await toReadMedias({ skipHydrate: true })
    toast.success(keep ? '已保存，不会被自动清理' : '已取消保存')
  }

  async function removeSelected() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const medias = useGalleryStore.getState().medias
    const mediaById = new Map(
      medias.map(function (media) {
        return [media.asset.id, media]
      })
    )
    const { remove } = await import('@tauri-apps/plugin-fs')
    await Promise.all(
      ids.map(async function (id) {
        const media = mediaById.get(id)
        if (!media?.meta.isManaged) return
        try {
          await remove(media.asset.filePath)
        } catch (error) {
          console.warn('[capture] remove file failed', error)
        }
      })
    )
    await invoke(CHANNELS.ASSET.REMOVE, {
      params:
        ids.length === 1
          ? { id: ids[0] }
          : ids.map(function (id) {
              return { id }
            })
    })
    onSelectedIds(new Set())
    onSelecting(false)
    await toReadMedias({ skipHydrate: true })
    toast.success(`已删除 ${ids.length} 项`)
  }

  async function copySelected() {
    const id = Array.from(selectedIds)[0]
    if (!id) return
    const media = scoped.find(function (item) {
      return item.asset.id === id
    })
    if (!media) return
    try {
      if (media.kind === 'image') {
        const bytes = await readFile(media.asset.filePath)
        await writeImage(bytes)
      } else {
        await writeText(media.asset.filePath)
      }
      toast.success('已复制')
    } catch (error) {
      toast.error(`复制失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function saveSelected() {
    const id = Array.from(selectedIds)[0]
    if (!id) return
    const media = scoped.find(function (item) {
      return item.asset.id === id
    })
    if (!media) return
    const dest = await dialogSave({
      defaultPath: media.asset.fileName
    })
    if (!dest) return
    try {
      const { copyFile } = await import('@tauri-apps/plugin-fs')
      await copyFile(media.asset.filePath, dest)
      toast.success('已另存为')
    } catch (error) {
      toast.error(`另存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function attachToAlbum(albumID: string) {
    await toAttachAlbum(Array.from(selectedIds), albumID)
    toast.success('已加入相簿')
  }

  async function detachFromAlbum(albumID: string) {
    await toDetachAlbum(Array.from(selectedIds), albumID)
    toast.success('已移出相簿')
  }

  return {
    attachToAlbum,
    copySelected,
    detachFromAlbum,
    patchKeep,
    removeSelected,
    saveSelected
  }
}

export { useCaptureActions }
export type { CaptureActionsOptions }
