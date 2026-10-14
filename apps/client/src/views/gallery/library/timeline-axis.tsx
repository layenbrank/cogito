import { cn } from 'cn'
import { useMemo } from 'react'

import { STREAM_SECTION_CHUNK } from '@/views/gallery/constraints'
import { useStreamedCount } from '@/views/gallery/hooks/use-streamed-count'
import { MediaCell } from '@/views/gallery/library/media-cell'
import { groupByDay } from '@/views/gallery/library/time-buckets'
import { formatDuration, type GalleryMedia } from '@/views/gallery/model/media'

interface TimelineAxisProps {
  medias: GalleryMedia[]
  selecting: boolean
  selectedIds: Set<string>
  onOpen: (media: GalleryMedia) => void
  onToggleSelect: (media: GalleryMedia) => void
  className?: string
}

function TimelineAxis(props: TimelineAxisProps) {
  const days = groupByDay(props.medias)
  const resetKey = useMemo(
    function () {
      return `axis:${props.medias.length}:${props.medias[0]?.asset.id ?? ''}`
    },
    [props.medias]
  )
  const shown = useStreamedCount(days.length, resetKey, STREAM_SECTION_CHUNK)

  return (
    <div className={cn('relative pb-28', props.className)}>
      <div className="pointer-events-none absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 bg-border" />
      <div className="space-y-10">
        {days.slice(0, shown).map(function (day) {
          return (
            <section
              key={day.key}
              data-gallery-section={day.key}
              className="scroll-mt-4 bg-background">
              <div className="relative mb-4 flex justify-center">
                <span className="z-10 rounded-full border border-border/60 bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
                  {day.label}
                </span>
              </div>
              <ul className="space-y-8">
                {day.medias.map(function (media, index) {
                  const isLeft = index % 2 === 0
                  const duration = formatDuration(media.meta.durationMs)
                  return (
                    <li
                      key={media.asset.id}
                      className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                      <div className={cn('flex', isLeft ? 'justify-end' : 'justify-start opacity-0')}>
                        {isLeft ? (
                          <div className="w-[min(100%,220px)] space-y-1 text-right">
                            <MediaCell
                              media={media}
                              selecting={props.selecting}
                              selected={props.selectedIds.has(media.asset.id)}
                              onOpen={props.onOpen}
                              onToggleSelect={props.onToggleSelect}
                              className="rounded-xl"
                            />
                            <div className="truncate px-1 text-xs text-muted-foreground">
                              {media.asset.fileName}
                              {duration ? ` · ${duration}` : ''}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="relative z-10 flex size-3 items-center justify-center rounded-full border-2 border-primary bg-background" />
                      <div className={cn('flex', isLeft ? 'justify-end opacity-0' : 'justify-start')}>
                        {!isLeft ? (
                          <div className="w-[min(100%,220px)] space-y-1 text-left">
                            <MediaCell
                              media={media}
                              selecting={props.selecting}
                              selected={props.selectedIds.has(media.asset.id)}
                              onOpen={props.onOpen}
                              onToggleSelect={props.onToggleSelect}
                              className="rounded-xl"
                            />
                            <div className="truncate px-1 text-xs text-muted-foreground">
                              {media.asset.fileName}
                              {duration ? ` · ${duration}` : ''}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}

export { TimelineAxis }
export type { TimelineAxisProps }
