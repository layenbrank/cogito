/**
 * 图库 / 截屏 provider
 */
import Fuse from 'fuse.js'

import { OMNIBAR_UI } from '@/features/command-bar/constants'
import { openComponentRoute } from '@/features/command-bar/open-route'
import type { Hit, SearchProvider } from '@/features/command-bar/types'
import { useGalleryStore } from '@/stores/gallery'
import type { GalleryMedia } from '@/views/gallery/model/media'

const fuseByMedias = new WeakMap<GalleryMedia[], Fuse<GalleryMedia>>()

function findFuse(medias: GalleryMedia[]) {
  let fuse = fuseByMedias.get(medias)
  if (fuse) return fuse
  fuse = new Fuse(medias, {
    keys: [
      { name: 'asset.fileName', weight: 0.7 },
      { name: 'kind', weight: 0.2 },
      { name: 'asset.mime', weight: 0.1 }
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true
  })
  fuseByMedias.set(medias, fuse)
  return fuse
}

function searchGallery(query: string): Hit[] {
  const medias = useGalleryStore.getState().medias
  if (!medias.length) return []

  type Scored = { media: GalleryMedia; score: number }

  const rows: Scored[] = query.trim()
    ? findFuse(medias)
        .search(query)
        .slice(0, OMNIBAR_UI.LOCAL_LIMIT)
        .map(function (row) {
          return {
            media: row.item,
            score: row.score == null ? 1 : 1 - row.score
          }
        })
    : medias.slice(0, OMNIBAR_UI.LOCAL_LIMIT).map(function (media) {
        return { media, score: 0.5 }
      })

  return rows.map(function (row) {
    const isCapture = row.media.meta?.source === 'capture'
    return {
      domain: 'gallery' as const,
      id: row.media.asset.id,
      title: row.media.asset.fileName,
      subtitle: isCapture ? '截屏' : row.media.kind,
      score: row.score,
      icon: isCapture ? 'lucide:camera' : 'lucide:image',
      async run() {
        await openComponentRoute('gallery', { id: row.media.asset.id })
      }
    }
  })
}

const galleryProvider: SearchProvider = {
  domain: 'gallery',
  search(query) {
    return searchGallery(query)
  }
}

export { galleryProvider }
