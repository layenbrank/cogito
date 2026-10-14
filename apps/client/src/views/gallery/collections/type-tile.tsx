import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

import type { GalleryMedia } from '@/views/gallery/model/media'

interface TypeTileProps {
  icon: string
  label: string
  count: number
  locked?: boolean
  /** 封面图（最多 4 张拼贴） */
  covers?: GalleryMedia[]
  onClick: () => void
  className?: string
}

function CoverStack(props: { covers: GalleryMedia[] }) {
  const covers = props.covers.slice(0, 4)
  if (covers.length === 0) {
    return <div className="size-full bg-muted/60" />
  }
  if (covers.length === 1) {
    const media = covers[0]!
    return media.kind === 'video' ? (
      <video className="size-full object-cover" src={media.src} muted preload="metadata" />
    ) : (
      <img className="size-full object-cover" src={media.src} alt="" loading="lazy" />
    )
  }

  return (
    <div className="grid size-full grid-cols-2 grid-rows-2 gap-px bg-border/40">
      {covers.map(function (media) {
        return media.kind === 'video' ? (
          <video
            key={media.asset.id}
            className="size-full object-cover"
            src={media.src}
            muted
            preload="metadata"
          />
        ) : (
          <img
            key={media.asset.id}
            className="size-full object-cover"
            src={media.src}
            alt=""
            loading="lazy"
          />
        )
      })}
    </div>
  )
}

function TypeTile(props: TypeTileProps) {
  const hasCover = (props.covers?.length ?? 0) > 0

  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl bg-muted/40 text-left transition-colors',
        'hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        props.className
      )}>
      <div className="relative aspect-[5/3] w-full overflow-hidden bg-muted/50">
        {hasCover ? (
          <CoverStack covers={props.covers!} />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground/50">
            <Icon icon={props.icon} className="size-8" />
          </div>
        )}
        {props.locked ? (
          <span className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Icon icon="lucide:lock" className="size-3.5" />
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Icon icon={props.icon} className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{props.label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{props.count}</span>
      </div>
    </button>
  )
}

export { TypeTile }
export type { TypeTileProps }
