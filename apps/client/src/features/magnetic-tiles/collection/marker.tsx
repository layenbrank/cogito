import { Icon } from '@iconify/react/offline'
import { invoke } from '@tauri-apps/api/core'
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { CHANNELS } from '@/shared/ipc/channels'

import {
  MagneticTile,
  type MarkerProps
} from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/collection/marker.module.scss'
import { useCollectionStore } from '@/stores/collection'

type Props = Omit<MarkerProps, 'children'> & {
  /** 主镜磁贴有 id；overlay 预览可不传，此时只显示空文件夹图标 */
  id?: string
}

const PREVIEW_COUNT = 4

function findInitial(title: string) {
  return [...title].at(0) ?? '?'
}

export default function Marker(props: Props) {
  const [previews, onUpdatePreviews] = useState<string[]>([])
  const revision = useCollectionStore(function (state) {
    return state.revision
  })

  useEffect(
    function () {
      const collectionId = props.id
      if (!collectionId) return

      let cancelled = false

      async function toLoad() {
        try {
          const members = await invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
            params: { collectionID: collectionId }
          })
          if (cancelled) return
          onUpdatePreviews(
            members
              .toSorted(function (a, b) {
                return a.index - b.index
              })
              .slice(0, PREVIEW_COUNT)
              .map(function (tile) {
                return tile.mark || findInitial(tile.title)
              })
          )
        } catch (error) {
          console.warn('[collection-marker] preview load failed', error)
          if (!cancelled) onUpdatePreviews([])
        }
      }

      void toLoad()
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
