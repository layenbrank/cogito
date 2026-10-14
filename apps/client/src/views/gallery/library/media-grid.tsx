import { cn } from 'cn'
import { useMemo, type CSSProperties } from 'react'

import type { TimeScope } from '@/views/gallery/constraints'
import { STREAM_SECTION_CHUNK } from '@/views/gallery/constraints'
import { useStreamedCount } from '@/views/gallery/hooks/use-streamed-count'
import { MediaCell } from '@/views/gallery/library/media-cell'
import { findSectionMedias } from '@/views/gallery/library/time-buckets'
import type { DayBucket, GalleryMedia, MonthBucket, YearBucket } from '@/views/gallery/model/media'

interface MediaGridProps {
  medias: GalleryMedia[]
  scope: TimeScope
  columns: number
  selecting: boolean
  selectedIds: Set<string>
  onOpen: (media: GalleryMedia) => void
  onToggleSelect: (media: GalleryMedia) => void
  className?: string
}

function SectionHeader(props: { label: string; count: number }) {
  return (
    <header className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-border/40 bg-background px-1 py-2">
      <h3 className="text-sm font-semibold text-foreground">{props.label}</h3>
      <span className="text-xs text-muted-foreground">{props.count}</span>
    </header>
  )
}

function DaySection(props: {
  bucket: DayBucket
  columns: number
  selecting: boolean
  selectedIds: Set<string>
  onOpen: (media: GalleryMedia) => void
  onToggleSelect: (media: GalleryMedia) => void
}) {
  return (
    <section data-gallery-section={props.bucket.key} className="scroll-mt-2 bg-background">
      <SectionHeader label={props.bucket.label} count={props.bucket.medias.length} />
      <div
        className="grid gap-px bg-background"
        style={
          {
            gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))`
          } as CSSProperties
        }>
        {props.bucket.medias.map(function (media) {
          return (
            <MediaCell
              key={media.asset.id}
              media={media}
              selecting={props.selecting}
              selected={props.selectedIds.has(media.asset.id)}
              onOpen={props.onOpen}
              onToggleSelect={props.onToggleSelect}
            />
          )
        })}
      </div>
    </section>
  )
}

function MonthSection(props: {
  bucket: MonthBucket
  columns: number
  selecting: boolean
  selectedIds: Set<string>
  onOpen: (media: GalleryMedia) => void
  onToggleSelect: (media: GalleryMedia) => void
}) {
  return (
    <section data-gallery-section={props.bucket.key} className="scroll-mt-2 space-y-3">
      <SectionHeader label={props.bucket.label} count={props.bucket.medias.length} />
      {props.bucket.days.map(function (day) {
        return (
          <DaySection
            key={day.key}
            bucket={day}
            columns={props.columns}
            selecting={props.selecting}
            selectedIds={props.selectedIds}
            onOpen={props.onOpen}
            onToggleSelect={props.onToggleSelect}
          />
        )
      })}
    </section>
  )
}

function YearSection(props: {
  bucket: YearBucket
  columns: number
  selecting: boolean
  selectedIds: Set<string>
  onOpen: (media: GalleryMedia) => void
  onToggleSelect: (media: GalleryMedia) => void
}) {
  return (
    <section data-gallery-section={props.bucket.key} className="scroll-mt-2 space-y-4">
      <SectionHeader label={props.bucket.label} count={props.bucket.medias.length} />
      <div
        className="grid gap-2 bg-background"
        style={{ gridTemplateColumns: `repeat(${Math.min(props.columns, 4)}, minmax(0, 1fr))` }}>
        {props.bucket.months.map(function (month) {
          const cover = month.medias[0]
          return (
            <button
              key={month.key}
              type="button"
              className="group relative aspect-square overflow-hidden rounded-xl bg-muted/40 transition-transform duration-200 ease-out active:scale-[0.98]"
              onClick={function () {
                if (cover) props.onOpen(cover)
              }}>
              {cover ? (
                cover.kind === 'video' ? (
                  <video
                    className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    src={cover.src}
                    muted
                    preload="metadata"
                  />
                ) : (
                  <img
                    className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    src={cover.src}
                    alt=""
                    loading="lazy"
                  />
                )
              ) : null}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-2 text-left">
                <div className="text-sm font-medium text-white">{month.label}</div>
                <div className="text-xs text-white/80">{month.medias.length} 项</div>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function MediaGrid(props: MediaGridProps) {
  const sections = findSectionMedias(props.medias, props.scope)
  const resetKey = useMemo(
    function () {
      return `${props.scope}:${props.medias.length}:${props.medias[0]?.asset.id ?? ''}:${props.medias[props.medias.length - 1]?.asset.id ?? ''}`
    },
    [props.scope, props.medias]
  )
  const shown = useStreamedCount(sections.length, resetKey, STREAM_SECTION_CHUNK)
  const visibleSections = sections.slice(0, shown)

  if (props.scope === 'years') {
    return (
      <div className={cn('space-y-6 pb-28', props.className)}>
        {(visibleSections as YearBucket[]).map(function (bucket) {
          return (
            <YearSection
              key={bucket.key}
              bucket={bucket}
              columns={props.columns}
              selecting={props.selecting}
              selectedIds={props.selectedIds}
              onOpen={props.onOpen}
              onToggleSelect={props.onToggleSelect}
            />
          )
        })}
      </div>
    )
  }

  if (props.scope === 'months') {
    return (
      <div className={cn('space-y-6 pb-28', props.className)}>
        {(visibleSections as MonthBucket[]).map(function (bucket) {
          return (
            <MonthSection
              key={bucket.key}
              bucket={bucket}
              columns={props.columns}
              selecting={props.selecting}
              selectedIds={props.selectedIds}
              onOpen={props.onOpen}
              onToggleSelect={props.onToggleSelect}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div className={cn('space-y-4 pb-28', props.className)}>
      {(visibleSections as DayBucket[]).map(function (bucket) {
        return (
          <DaySection
            key={bucket.key}
            bucket={bucket}
            columns={props.columns}
            selecting={props.selecting}
            selectedIds={props.selectedIds}
            onOpen={props.onOpen}
            onToggleSelect={props.onToggleSelect}
          />
        )
      })}
    </div>
  )
}

export { MediaGrid }
export type { MediaGridProps }
