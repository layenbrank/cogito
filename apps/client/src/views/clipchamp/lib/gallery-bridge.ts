import { useEffect, useState } from 'react'

import { useGalleryStore } from '@/stores/gallery.ts'

interface GalleryBridgeItem {
  id: string
  path: string
  name: string
  kind: 'video' | 'image'
  durationMs?: number
}

function useGalleryBridge(): GalleryBridgeItem[] {
  const medias = useGalleryStore(function (s) {
    return s.medias
  })
  const loaded = useGalleryStore(function (s) {
    return s.loaded
  })
  const toReadMedias = useGalleryStore(function (s) {
    return s.toReadMedias
  })
  const [items, setItems] = useState<GalleryBridgeItem[]>([])

  useEffect(
    function () {
      if (!loaded) {
        void toReadMedias({ skipHydrate: true })
      }
    },
    [loaded, toReadMedias]
  )

  useEffect(
    function () {
      const next = medias
        .filter(function (media) {
          return media.kind === 'video'
        })
        .slice(0, 24)
        .map(function (media) {
          return {
            id: media.asset.id,
            path: media.asset.filePath,
            name: media.asset.fileName,
            kind: 'video' as const,
            durationMs: media.meta.durationMs
          }
        })
      setItems(next)
    },
    [medias]
  )

  return items
}

export { useGalleryBridge }
export type { GalleryBridgeItem }
