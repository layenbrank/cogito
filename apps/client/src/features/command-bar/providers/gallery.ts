/**
 * 图库 / 截屏 provider
 *
 * 读 **catalog store**，与图库页同一份真相：旧版读 `stores/gallery` 的全量 `medias`，
 * 而图库重构后那个 store 只有在打开 capture 页时才会被填充，结果就是命令面板里的图库命中
 * 会默默变空。
 */
import Fuse from 'fuse.js'

import { OMNIBAR_UI } from '@/features/command-bar/constants'
import { openComponentRoute } from '@/features/command-bar/open-route'
import type { Hit, SearchProvider } from '@/features/command-bar/types'
import type { GalleryRow } from '@/views/gallery/model/asset'
import { useCatalogStore } from '@/views/gallery/store/catalog'

const fuseByRows = new WeakMap<GalleryRow[], Fuse<GalleryRow>>()

function findFuse(rows: GalleryRow[]) {
  let fuse = fuseByRows.get(rows)
  if (fuse) return fuse
  fuse = new Fuse(rows, {
    keys: [
      { name: 'name', weight: 0.7 },
      { name: 'kind', weight: 0.2 },
      { name: 'mime', weight: 0.1 }
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true
  })
  fuseByRows.set(rows, fuse)
  return fuse
}

function searchGallery(query: string): Hit[] {
  const rows = useCatalogStore.getState().rows
  if (!rows.length) return []

  type Scored = { row: GalleryRow; score: number }

  const scored: Scored[] = query.trim()
    ? findFuse(rows)
        .search(query)
        .slice(0, OMNIBAR_UI.LOCAL_LIMIT)
        .map(function (hit) {
          return {
            row: hit.item,
            score: hit.score === null || hit.score === undefined ? 1 : 1 - hit.score
          }
        })
    : rows.slice(0, OMNIBAR_UI.LOCAL_LIMIT).map(function (row) {
        return { row, score: 0.5 }
      })

  return scored.map(function (entry) {
    const isCapture = entry.row.source === 'capture'
    return {
      domain: 'gallery' as const,
      id: entry.row.id,
      title: entry.row.name,
      subtitle: isCapture ? '截屏' : entry.row.kind,
      score: entry.score,
      icon: isCapture ? 'lucide:camera' : 'lucide:image',
      async run() {
        await openComponentRoute('gallery')
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
