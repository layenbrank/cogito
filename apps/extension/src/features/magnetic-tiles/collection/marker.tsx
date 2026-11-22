import { Icon } from '@iconify/react/offline'
import { useEffect, useState, type CSSProperties } from 'react'

import {
  MagneticTile,
  type MarkerProps
} from '@/features/magnetic-tile/magnetic-tile.tsx'
import { markerClass } from '@/features/magnetic-tile/marker'
import styles from '@/features/magnetic-tiles/collection/marker.module.scss'
import {
  fetchCollectionMarkerPreviews,
  type CollectionPreview,
  readCollectionMarkerPreviews
} from '@/features/magnetic-tiles/collection/preview-cache'
import { findCollectionPreviewLayout } from '@/features/magnetic-tiles/collection/preview-layout'
import { useCollectionStore } from '@/stores/collection'

type Props = Omit<MarkerProps, 'children'> & {
  /** 主镜磁贴有 id；overlay 预览可不传，此时只显示空文件夹图标 */
  id?: string
}

function PreviewCell(props: { item: CollectionPreview }) {
  const [isBroken, onUpdateBroken] = useState(false)
  const showsImage = Boolean(props.item.src) && !isBroken

  useEffect(
    function () {
      onUpdateBroken(false)
    },
    [props.item.src]
  )

  const cellStyle = {
    ...(props.item.surface ? { backgroundColor: props.item.surface } : null),
    ...(props.item.ink ? { color: props.item.ink } : null)
  }

  return (
    <span
      className={styles.previewCell}
      style={cellStyle}>
      {showsImage ? (
        <img
          src={props.item.src!}
          alt=""
          className={styles.previewIcon}
          onError={function () {
            console.warn('[collection] 预览图加载失败:', props.item.src)
            onUpdateBroken(true)
          }}
        />
      ) : (
        props.item.label
      )}
    </span>
  )
}

export default function Marker(props: Props) {
  const revision = useCollectionStore(function (state) {
    return state.revision
  })
  const [previews, onUpdatePreviews] = useState(function () {
    if (!props.id) return [] as CollectionPreview[]
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

  const layout = findCollectionPreviewLayout(
    props.size,
    props.shape,
    props.direction,
    previews.length
  )
  const visible = previews.slice(0, layout.count)
  const isEmpty = visible.length === 0
  const framePercent = Math.round(layout.frameScale * 1000) / 10
  const frameStyle = {
    width: `${framePercent}%`,
    height: `${framePercent}%`
  }
  const gridStyle = {
    '--cols': String(layout.columns),
    '--rows': String(layout.rows),
    '--flow': layout.flow,
    '--cell': `${layout.cell}px`,
    '--gap-x': `${layout.gapX}px`,
    '--gap-y': `${layout.gapY}px`,
    '--pad-x': `${layout.padX}px`,
    '--pad-y': `${layout.padY}px`,
    '--icon': `${Math.round(layout.iconScale * 100)}%`,
    gridAutoFlow: layout.flow
  } as CSSProperties

  return (
    <MagneticTile.Marker
      {...props}
      className={markerClass(styles, props.size, props.shape, props.direction)}>
      {isEmpty ? (
        <Icon
          icon="lucide:folder"
          className={styles.folderIcon}
          aria-hidden
        />
      ) : (
        <div
          className={styles.previewFrame}
          style={frameStyle}>
          <div
            className={styles.previewGrid}
            style={gridStyle}>
            {visible.map(function (item, index) {
              return (
                <PreviewCell
                  key={`${item.label}-${item.src ?? 'glyph'}-${index}`}
                  item={item}
                />
              )
            })}
          </div>
        </div>
      )}
    </MagneticTile.Marker>
  )
}
