import { convertFileSrc, invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'
import {
  filterVisible,
  sortByCapturedAt,
  toGalleryMedia,
  type GalleryAsset
} from '@/views/gallery/model/media'

const PREVIEW_COUNT = 4

let cachedThumbs: string[] | null = null
let inflight: Promise<string[]> | null = null
/** invalidate 递增；in-flight resolve 时比对，避免写回已失效数据 */
let generation = 0

async function fetchGalleryThumbs(): Promise<string[]> {
  const assets = await invoke<GalleryAsset[]>(CHANNELS.ASSET.READ, { params: {} })
  const medias = sortByCapturedAt(
    filterVisible(
      assets
        .map(function (asset) {
          return toGalleryMedia(asset, convertFileSrc(asset.filePath))
        })
        .filter(function (media): media is NonNullable<typeof media> {
          return media !== null
        })
    )
  ).slice(0, PREVIEW_COUNT)
  return medias.map(function (media) {
    return media.src
  })
}

function readGalleryMarkerThumbs() {
  return cachedThumbs
}

/** 图库 marker 缩略图；模块缓存避免 Activity 再 visible 时重复 IPC */
function fetchGalleryMarkerThumbs(): Promise<string[]> {
  if (cachedThumbs !== null) return Promise.resolve(cachedThumbs)
  if (inflight) return inflight
  const requestGeneration = generation
  inflight = fetchGalleryThumbs()
    .then(function (thumbs) {
      if (requestGeneration !== generation) return thumbs
      cachedThumbs = thumbs
      return thumbs
    })
    .catch(function () {
      if (requestGeneration !== generation) return []
      cachedThumbs = []
      return []
    })
    .finally(function () {
      if (requestGeneration === generation) inflight = null
    })
  return inflight
}

/** 图库内容变更后清缓存，下次 marker mount 再读 */
function invalidateGalleryMarkerThumbs() {
  generation += 1
  cachedThumbs = null
  inflight = null
}

export {
  fetchGalleryMarkerThumbs,
  invalidateGalleryMarkerThumbs,
  readGalleryMarkerThumbs
}
