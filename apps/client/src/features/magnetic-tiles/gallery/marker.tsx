import clsx from 'clsx'
import { useEffect, useState } from 'react'

import {
  MagneticTile,
  type MarkerProps
} from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/gallery/marker.module.scss'
import {
  fetchGalleryMarkerThumbs,
  readGalleryMarkerThumbs
} from '@/features/magnetic-tiles/gallery/preview-cache'

type Props = Omit<MarkerProps, 'children'>

function Marker(props: Props) {
  const [thumbs, onThumbs] = useState(function () {
    return readGalleryMarkerThumbs() ?? []
  })

  useEffect(function () {
    let active = true
    void fetchGalleryMarkerThumbs().then(function (next) {
      if (active) onThumbs(next)
    })
    return function () {
      active = false
    }
  }, [])

  return (
    <MagneticTile.Marker
      {...props}
      className={clsx([
        styles.marker,
        props.size,
        props.direction,
        props.shape
      ])}>
      {thumbs.length === 0 ? (
        <span className="text-xs text-muted-foreground">图库</span>
      ) : (
        <div
          className={clsx(
            'grid size-full gap-px overflow-hidden',
            thumbs.length === 1 && 'grid-cols-1',
            thumbs.length === 2 && 'grid-cols-2',
            thumbs.length >= 3 && 'grid-cols-2 grid-rows-2'
          )}>
          {thumbs.map(function (src) {
            return (
              <img
                key={src}
                src={src}
                alt=""
                className="size-full min-h-0 object-cover"
                loading="lazy"
              />
            )
          })}
        </div>
      )}
    </MagneticTile.Marker>
  )
}

export default Marker
