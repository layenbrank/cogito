import clsx from 'clsx'
import { useState } from 'react'

import {
  MagneticTile,
  type MarkerProps
} from '@/features/magnetic-tile/magnetic-tile.tsx'

import { orderWallpaperLibrary, type WallpaperFrame } from './catalog'
import { findWallpaperShelf } from './shelf'

type Props = Pick<MagneticTile, 'title'> &
  Omit<MarkerProps, 'children'> & {
    url?: string | null
  }

function ShelfPhoto(props: { frame: WallpaperFrame }) {
  const [isBroken, onBroken] = useState(false)

  if (isBroken) {
    return (
      <div
        role="img"
        aria-label={props.frame.title}
        className="size-full bg-muted"
      />
    )
  }

  return (
    <img
      src={props.frame.src}
      alt={props.frame.title}
      loading="lazy"
      decoding="async"
      className="size-full object-cover"
      onError={function () {
        console.warn('[wallpaper] image failed', props.frame.src)
        onBroken(true)
      }}
    />
  )
}

function Marker(props: Props) {
  const shelf = findWallpaperShelf(props.size, props.shape, props.direction)
  const frames = orderWallpaperLibrary(props.url)
  const capacity = shelf.columns * shelf.rows
  const overflow = Math.max(0, frames.length - capacity)
  const shown = overflow > 0 ? frames.slice(0, capacity - 1) : frames.slice(0, capacity)

  return (
    <MagneticTile.Marker
      size={props.size}
      shape={props.shape}
      direction={props.direction}
      className={clsx(
        'relative size-full overflow-hidden bg-border',
        shelf.clipsCircle ? 'rounded-full' : 'rounded-[inherit]'
      )}>
      <div
        className={clsx(
          'grid gap-px',
          shelf.clipsCircle
            ? 'absolute top-1/2 left-1/2 h-[70.7%] w-[70.7%] -translate-x-1/2 -translate-y-1/2'
            : 'size-full'
        )}
        style={{
          gridTemplateColumns: `repeat(${shelf.columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${shelf.rows}, minmax(0, 1fr))`
        }}>
        {shown.map(function (frame) {
          return (
            <ShelfPhoto
              key={frame.src}
              frame={frame}
            />
          )
        })}
        {overflow > 0 ? (
          <div className="flex size-full items-center justify-center bg-signin-brand text-xs font-medium text-signin-brand-foreground">
            +{overflow}
          </div>
        ) : null}
      </div>
    </MagneticTile.Marker>
  )
}

export default Marker
export { Marker }
