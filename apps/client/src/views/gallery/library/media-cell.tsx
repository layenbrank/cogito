import { Button } from '@cogito/design/components/button'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { memo, type ReactNode } from 'react'

import { useNearViewport } from '@/views/gallery/hooks/use-near-viewport'
import { formatDuration, type GalleryMedia } from '@/views/gallery/model/media'

interface MediaCellProps {
  media: GalleryMedia
  selected?: boolean
  selecting?: boolean
  onOpen: (media: GalleryMedia) => void
  onToggleSelect?: (media: GalleryMedia) => void
  className?: string
  /** 额外角标（保存 / 将清理等）；与时长角标可并存 */
  badge?: ReactNode
  isKept?: boolean
}

function MediaCellComponent(props: MediaCellProps) {
  const duration = formatDuration(props.media.meta.durationMs)
  const isVideo = props.media.kind === 'video'
  const { ref, isNear } = useNearViewport<HTMLButtonElement>()

  function handleClick() {
    if (props.selecting && props.onToggleSelect) {
      props.onToggleSelect(props.media)
      return
    }
    props.onOpen(props.media)
  }

  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      className={cn(
        'group relative aspect-square overflow-hidden rounded-md bg-muted/40 outline-none',
        '[content-visibility:auto] [contain-intrinsic-size:auto_120px]',
        'transition-[box-shadow,transform] duration-200 ease-out',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'active:scale-[0.98]',
        props.selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        props.className
      )}
      onClick={handleClick}
      aria-label={props.media.asset.fileName}>
      {isNear ? (
        isVideo ? (
          <video
            className="size-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.03]"
            src={props.media.src}
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <img
            className="size-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.03]"
            src={props.media.src}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )
      ) : (
        <span className="block size-full bg-muted/50" aria-hidden />
      )}
      {props.isKept ? (
        <span
          className="pointer-events-none absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-success text-success-foreground"
          title="已保存，不会被自动清理">
          <Icon icon="lucide:pin" className="size-3" aria-hidden />
        </span>
      ) : null}
      {props.badge ? (
        <span className="pointer-events-none absolute top-1.5 left-1.5 max-w-[90%]">{props.badge}</span>
      ) : null}
      {isVideo && duration ? (
        <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-black/65 px-1 py-0.5 text-xs leading-none text-white tabular-nums">
          {duration}
        </span>
      ) : null}
      {props.selecting ? (
        <span
          className={cn(
            'absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full border border-white/80 bg-black/35 text-white transition-colors duration-150',
            props.selected && 'border-primary bg-primary',
            props.badge && 'top-auto bottom-1.5'
          )}>
          {props.selected ? <Icon icon="lucide:check" className="size-3" /> : null}
        </span>
      ) : null}
    </Button>
  )
}

const MediaCell = memo(MediaCellComponent)

export { MediaCell }
export type { MediaCellProps }
