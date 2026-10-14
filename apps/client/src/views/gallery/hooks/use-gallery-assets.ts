import { useEffect, useMemo } from 'react'

import { useGalleryStore } from '@/stores/gallery'
import {
  filterVisible,
  findHidden,
  findPhotos,
  findScreenshots,
  findVideos,
  sortByCapturedAt
} from '@/views/gallery/model/media'

function useGalleryAssets() {
  const medias = useGalleryStore(function (state) {
    return state.medias
  })
  const loaded = useGalleryStore(function (state) {
    return state.loaded
  })
  const importing = useGalleryStore(function (state) {
    return state.importing
  })
  const toReadMedias = useGalleryStore(function (state) {
    return state.toReadMedias
  })
  const toImportMedias = useGalleryStore(function (state) {
    return state.toImportMedias
  })
  const toHideMedias = useGalleryStore(function (state) {
    return state.toHideMedias
  })
  const toRemoveMedias = useGalleryStore(function (state) {
    return state.toRemoveMedias
  })

  useEffect(
    function () {
      void toReadMedias()
    },
    [toReadMedias]
  )

  const visible = useMemo(
    function () {
      return sortByCapturedAt(filterVisible(medias))
    },
    [medias]
  )
  const photos = useMemo(
    function () {
      return findPhotos(visible)
    },
    [visible]
  )
  const videos = useMemo(
    function () {
      return findVideos(visible)
    },
    [visible]
  )
  const screenshots = useMemo(
    function () {
      return findScreenshots(visible)
    },
    [visible]
  )
  const hidden = useMemo(
    function () {
      return sortByCapturedAt(findHidden(medias))
    },
    [medias]
  )

  return {
    medias,
    visible,
    photos,
    videos,
    screenshots,
    hidden,
    loaded,
    importing,
    toReadMedias,
    toImportMedias,
    toHideMedias,
    toRemoveMedias
  }
}

function useRecentThumbnails(limit = 4) {
  const medias = useGalleryStore(function (state) {
    return state.medias
  })
  return useMemo(
    function () {
      return sortByCapturedAt(filterVisible(medias)).slice(0, limit)
    },
    [medias, limit]
  )
}

export { useGalleryAssets, useRecentThumbnails }
