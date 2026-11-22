import { database } from '@/database/database.ts'

const PREVIEW_COUNT = 4

let cachedThumbs: string[] | null = null
let inflight: Promise<string[]> | null = null
let generation = 0
const liveUrls: string[] = []

function releaseUrls(): void {
  for (const url of liveUrls) URL.revokeObjectURL(url)
  liveUrls.length = 0
}

async function fetchGalleryThumbs(): Promise<string[]> {
  const rows = await database.galleryAsset.orderBy('createdAt').reverse().toArray()
  releaseUrls()
  const thumbs: string[] = []
  for (const row of rows) {
    if (row.hidden || row.kind !== 'photo') continue
    const url = URL.createObjectURL(row.blob)
    liveUrls.push(url)
    thumbs.push(url)
    if (thumbs.length >= PREVIEW_COUNT) break
  }
  return thumbs
}

function readGalleryMarkerThumbs(): string[] | null {
  return cachedThumbs
}

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
    .catch(function (error) {
      console.warn('[gallery] 缩略图加载失败:', error)
      return []
    })
    .finally(function () {
      if (requestGeneration === generation) inflight = null
    })
  return inflight
}

function invalidateGalleryMarkerThumbs(): void {
  generation += 1
  cachedThumbs = null
  inflight = null
}

export { fetchGalleryMarkerThumbs, invalidateGalleryMarkerThumbs, readGalleryMarkerThumbs }
