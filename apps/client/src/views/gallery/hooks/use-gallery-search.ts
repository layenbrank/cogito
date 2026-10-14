import Fuse from 'fuse.js'
import { useMemo } from 'react'

import { FUSE_THRESHOLD } from '@/views/gallery/constraints'
import type { GalleryMedia } from '@/views/gallery/model/media'

const fuseByMedias = new WeakMap<GalleryMedia[], Fuse<GalleryMedia>>()

function findFuse(medias: GalleryMedia[]) {
  let fuse = fuseByMedias.get(medias)
  if (fuse) return fuse
  fuse = new Fuse(medias, {
    keys: [
      { name: 'asset.fileName', weight: 0.7 },
      { name: 'asset.mime', weight: 0.2 },
      { name: 'kind', weight: 0.1 }
    ],
    threshold: FUSE_THRESHOLD,
    ignoreLocation: true
  })
  fuseByMedias.set(medias, fuse)
  return fuse
}

function searchMedias(medias: GalleryMedia[], query: string): GalleryMedia[] {
  const trimmed = query.trim()
  if (!trimmed) return medias
  return findFuse(medias)
    .search(trimmed)
    .map(function (hit) {
      return hit.item
    })
}

function useGallerySearch(medias: GalleryMedia[], query: string) {
  return useMemo(
    function () {
      return searchMedias(medias, query)
    },
    [medias, query]
  )
}

export { searchMedias, useGallerySearch }
