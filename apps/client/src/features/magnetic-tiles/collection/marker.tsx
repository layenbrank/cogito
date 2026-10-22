import { Icon } from '@iconify/react/offline'
import clsx from 'clsx'
import { useEffect, useState } from 'react'

import {
  MagneticTile,
  type MarkerProps
} from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/collection/marker.module.scss'
import {
  fetchCollectionMarkerPreviews,
  readCollectionMarkerPreviews
} from '@/features/magnetic-tiles/collection/preview-cache'
import { useCollectionStore } from '@/stores/collection'

type Props = Omit<MarkerProps, 'children'> & {
  /** 主镜磁贴有 id；overlay 预览可不传，此时只显示空文件夹图标 */
  id?: string
}

export default function Marker(props: Props) {
  const revision = useCollectionStore(function (state) {
    return state.revision
  })
  const [previews, onUpdatePreviews] = useState(function () {
    if (!props.id) return []
    return readCollectionMarkerPreviews(props.id, revision) ?? []
  })

  useEffect(
    function () {
      const collectionId = props.id
      if (!collectionId) return

      let cancelled = false
      void fetchCollectionMarkerPreviews(collectionId, revision).then(function (next) {
        if (!cancelled) onUpdatePreviews(next)
      })
      return function () {
        cancelled = true
      }
    },
    [props.id, revision]
  )

  const isEmpty = previews.length === 0

  return (
    <MagneticTile.Marker
      {...props}
      className={clsx([
        styles.marker,
        props.size,
        props.direction,
        props.shape
      ])}>
      {isEmpty ? (
        <Icon
          icon="lucide:folder"
          className={styles.folderIcon}
          aria-hidden
        />
      ) : (
        <div className={styles.previewGrid}>
          {previews.map(function (label, index) {
            return (
              <span
                key={`${label}-${index}`}
                className={styles.previewCell}>
                {label}
              </span>
            )
          })}
        </div>
      )}
    </MagneticTile.Marker>
  )
}
