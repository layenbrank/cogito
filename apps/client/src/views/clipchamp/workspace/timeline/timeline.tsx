import { Button } from '@i-thinking/design/components/button'
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject
} from 'react'

import { useClipchampStore } from '@/stores/clipchamp.ts'
import {
  findTrackDisplayName,
  formatTimecode,
  type Clip,
  type MediaAsset,
  type Track,
  type WaveformMeta
} from '@/views/clipchamp/lib/project'
import { ClipFilmstrip, ClipWaveform } from '@/views/clipchamp/workspace/timeline/clip-thumb'

const PX_PER_SECOND_BASE = 48
const TRACK_HEIGHT = 44

function Timeline() {
  const project = useClipchampStore(function (s) {
    return s.project
  })
  const playheadMs = useClipchampStore(function (s) {
    return s.playheadMs
  })
  const selectedClipId = useClipchampStore(function (s) {
    return s.selectedClipId
  })
  const timelineZoom = useClipchampStore(function (s) {
    return s.timelineZoom
  })
  const isSnapping = useClipchampStore(function (s) {
    return s.isSnapping
  })
  const assets = useClipchampStore(function (s) {
    return s.assets
  })
  const seek = useClipchampStore(function (s) {
    return s.seek
  })
  const selectClip = useClipchampStore(function (s) {
    return s.selectClip
  })
  const splitAtPlayhead = useClipchampStore(function (s) {
    return s.splitAtPlayhead
  })
  const removeSelected = useClipchampStore(function (s) {
    return s.removeSelected
  })
  const updateTimelineZoom = useClipchampStore(function (s) {
    return s.updateTimelineZoom
  })
  const updateSnapping = useClipchampStore(function (s) {
    return s.updateSnapping
  })
  const addTextClip = useClipchampStore(function (s) {
    return s.addTextClip
  })
  const importMedia = useClipchampStore(function (s) {
    return s.importMedia
  })
  const addAssetToTimeline = useClipchampStore(function (s) {
    return s.addAssetToTimeline
  })
  const applyLive = useClipchampStore(function (s) {
    return s.applyLive
  })
  const captureUndoPoint = useClipchampStore(function (s) {
    return s.captureUndoPoint
  })
  const patchAsset = useClipchampStore(function (s) {
    return s.patchAsset
  })

  const scrollRef = useRef<HTMLDivElement>(null)
  const pxPerMs = (PX_PER_SECOND_BASE * timelineZoom) / 1000
  const durationMs = Math.max(project.durationMs, 10000)
  const widthPx = durationMs * pxPerMs + 120
  const [viewRange, setViewRange] = useState({ startMs: 0, endMs: 12000 })

  useEffect(
    function () {
      const host = scrollRef.current
      if (!host) return
      let raf = 0

      function measure() {
        const el = scrollRef.current
        if (!el) return
        // clientWidth 为 0 时先按最小视口估，避免永久空抽帧
        const viewW = Math.max(el.clientWidth, 320)
        const startMs = el.scrollLeft / pxPerMs
        const endMs = (el.scrollLeft + viewW) / pxPerMs
        const span = Math.max(1000, endMs - startMs)
        const pad = span * 0.5
        const next = {
          startMs: Math.max(0, startMs - pad),
          endMs: endMs + pad
        }
        setViewRange(function (prev) {
          const threshold = span * 0.08
          if (
            Math.abs(prev.startMs - next.startMs) < threshold &&
            Math.abs(prev.endMs - next.endMs) < threshold
          ) {
            return prev
          }
          return next
        })
      }

      function onScroll() {
        if (raf) return
        raf = requestAnimationFrame(function () {
          raf = 0
          measure()
        })
      }

      measure()
      host.addEventListener('scroll', onScroll, { passive: true })
      const observer = new ResizeObserver(onScroll)
      observer.observe(host)
      return function () {
        host.removeEventListener('scroll', onScroll)
        observer.disconnect()
        if (raf) cancelAnimationFrame(raf)
      }
    },
    [pxPerMs, widthPx]
  )

  const ticks = useMemo(
    function () {
      const step = timelineZoom >= 2 ? 1000 : timelineZoom >= 1 ? 2000 : 5000
      const marks: number[] = []
      for (let t = 0; t <= durationMs; t += step) marks.push(t)
      return marks
    },
    [durationMs, timelineZoom]
  )

  function onRulerClick(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left + (scrollRef.current?.scrollLeft || 0)
    let ms = x / pxPerMs
    if (isSnapping) ms = Math.round(ms / 100) * 100
    seek(ms)
  }

  function onClipPointerDown(clip: Clip, event: PointerEvent) {
    event.stopPropagation()
    selectClip(clip.id)
    const startX = event.clientX
    const originStart = clip.startMs
    const trackId = clip.trackId
    let lastStart = originStart
    captureUndoPoint()

    function onMove(moveEvent: globalThis.PointerEvent) {
      const deltaPx = moveEvent.clientX - startX
      let nextStart = originStart + deltaPx / pxPerMs
      if (isSnapping) nextStart = Math.round(nextStart / 100) * 100
      nextStart = Math.max(0, nextStart)
      lastStart = nextStart
      applyLive(function (draft) {
        return {
          ...draft,
          tracks: draft.tracks.map(function (track) {
            if (track.id !== trackId) return track
            return {
              ...track,
              clips: track.clips.map(function (item) {
                return item.id === clip.id ? { ...item, startMs: nextStart } : item
              })
            }
          })
        }
      })
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      // finalize position without extra undo (already snapped before drag)
      applyLive(function (draft) {
        return {
          ...draft,
          tracks: draft.tracks.map(function (track) {
            if (track.id !== trackId) return track
            return {
              ...track,
              clips: track.clips.map(function (item) {
                return item.id === clip.id ? { ...item, startMs: lastStart } : item
              })
            }
          })
        }
      })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border/80 bg-background">
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border/80 bg-muted/10 px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="分割 (S)"
          className="size-7 text-muted-foreground"
          onClick={function () {
            splitAtPlayhead()
          }}>
          <Icon
            icon="lucide:scissors"
            className="size-3.5"
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="删除"
          className="size-7 text-muted-foreground"
          onClick={function () {
            removeSelected()
          }}>
          <Icon
            icon="lucide:trash-2"
            className="size-3.5"
          />
        </Button>
        <div className="mx-1 h-4 w-px bg-border/80" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={function () {
            addTextClip()
          }}>
          + 文字
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={function () {
            void importMedia()
          }}>
          + 音频/媒体
        </Button>

        <div className="ml-auto flex items-center gap-0.5">
          <Button
            type="button"
            variant={isSnapping ? 'default' : 'ghost'}
            size="icon-sm"
            title="吸附"
            className={clsx('size-7', !isSnapping && 'text-muted-foreground')}
            onClick={function () {
              updateSnapping(!isSnapping)
            }}>
            <Icon
              icon="lucide:magnet"
              className="size-3.5"
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 text-muted-foreground"
            onClick={function () {
              updateTimelineZoom(timelineZoom / 1.25)
            }}>
            <Icon
              icon="lucide:zoom-out"
              className="size-3.5"
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 text-muted-foreground"
            onClick={function () {
              updateTimelineZoom(1)
            }}
            title="适应">
            <Icon
              icon="lucide:scan"
              className="size-3.5"
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 text-muted-foreground"
            onClick={function () {
              updateTimelineZoom(timelineZoom * 1.25)
            }}>
            <Icon
              icon="lucide:zoom-in"
              className="size-3.5"
            />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[5.5rem] shrink-0 flex-col border-r border-border/80 bg-muted/15">
          <div className="h-7 shrink-0 border-b border-border/80" />
          {project.tracks.map(function (track) {
            return (
              <div
                key={track.id}
                className="flex items-center px-2.5 text-[11px] font-medium text-muted-foreground"
                style={{ height: TRACK_HEIGHT }}>
                {findTrackDisplayName(project, track)}
              </div>
            )
          })}
        </div>

        <div
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-auto bg-[#fafafa] dark:bg-muted/10"
          onDragOver={function (event) {
            event.preventDefault()
          }}
          onDrop={function (event) {
            event.preventDefault()
            const assetId = event.dataTransfer.getData('text/clipchamp-asset')
            if (assetId) addAssetToTimeline(assetId)
          }}>
          <div
            className="relative"
            style={{ width: widthPx, minHeight: '100%' }}>
            <div
              className="sticky top-0 z-20 h-7 cursor-pointer border-b border-border/80 bg-background/95 backdrop-blur-sm"
              onClick={onRulerClick}>
              {ticks.map(function (t) {
                return (
                  <div
                    key={t}
                    className="absolute top-0 h-full border-l border-border/50 pl-1 pt-1 text-[10px] tabular-nums text-muted-foreground/80"
                    style={{ left: t * pxPerMs }}>
                    {formatTimecode(t).slice(0, 5)}
                  </div>
                )
              })}
            </div>

            {project.tracks.map(function (track) {
              return (
                <TrackRow
                  key={track.id}
                  track={track}
                  pxPerMs={pxPerMs}
                  viewStartMs={viewRange.startMs}
                  viewEndMs={viewRange.endMs}
                  scrollRootRef={scrollRef}
                  selectedClipId={selectedClipId}
                  assets={assets}
                  onClipPointerDown={onClipPointerDown}
                  onSelectEmpty={function () {
                    selectClip(null)
                  }}
                  onWaveform={function (assetId, meta) {
                    patchAsset(assetId, { waveform: meta })
                  }}
                />
              )
            })}

            <div
              className="pointer-events-none absolute top-0 z-30 w-0.5 bg-primary shadow-[0_0_0_1px_rgba(0,0,0,0.04)]"
              style={{
                left: playheadMs * pxPerMs,
                height: 7 + project.tracks.length * TRACK_HEIGHT
              }}>
              <div className="absolute -left-[5px] top-0 size-2.5 rounded-full bg-primary ring-2 ring-background" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface TrackRowProps {
  track: Track
  pxPerMs: number
  viewStartMs: number
  viewEndMs: number
  scrollRootRef: RefObject<HTMLDivElement | null>
  selectedClipId: string | null
  assets: MediaAsset[]
  onClipPointerDown: (clip: Clip, event: PointerEvent) => void
  onSelectEmpty: () => void
  onWaveform(assetId: string, meta: WaveformMeta): void
}

function TrackRow(props: TrackRowProps) {
  const {
    track,
    pxPerMs,
    viewStartMs,
    viewEndMs,
    scrollRootRef,
    selectedClipId,
    assets,
    onClipPointerDown,
    onSelectEmpty,
    onWaveform
  } = props

  return (
    <div
      className="relative border-b border-border/40 bg-transparent"
      style={{ height: TRACK_HEIGHT }}
      onClick={onSelectEmpty}>
      {track.clips.length === 0 ? (
        <div className="flex h-full items-center px-3 text-[11px] text-muted-foreground/55">
          {track.kind === 'text'
            ? '+ 添加文字'
            : track.kind === 'audio'
              ? '+ 添加音频'
              : track.kind === 'caption'
                ? '+ 添加字幕'
                : track.kind === 'video'
                  ? '+ 添加视频'
                  : track.kind === 'overlay'
                    ? '+ 添加叠加'
                    : null}
        </div>
      ) : null}

      {track.clips.map(function (clip) {
        const width = Math.max(28, (clip.durationMs / Math.max(0.1, clip.speed)) * pxPerMs)
        const left = clip.startMs * pxPerMs
        const asset = assets.find(function (item) {
          return item.id === clip.assetId
        })
        const label = clip.label || clip.text?.content || asset?.name || clip.kind
        const isSelected = selectedClipId === clip.id
        const hasFilm =
          !!asset &&
          (clip.kind === 'video' || clip.kind === 'image') &&
          (asset.kind === 'video' || asset.kind === 'image')
        const hasWave = !!asset && clip.kind === 'audio'
        const tone =
          clip.kind === 'audio'
            ? 'border-emerald-500/50 bg-emerald-950/80 text-emerald-50'
            : clip.kind === 'text' || clip.kind === 'caption'
              ? 'border-amber-500/45 bg-amber-500/25 text-amber-950 dark:text-amber-50'
              : clip.kind === 'sticker'
                ? 'border-pink-500/45 bg-pink-500/25 text-pink-950 dark:text-pink-50'
                : hasFilm
                  ? 'border-primary/40 bg-black text-white'
                  : 'border-primary/45 bg-primary/20 text-foreground'

        return (
          <TimelineClipBlock
            key={clip.id}
            clip={clip}
            asset={asset}
            label={label}
            tone={tone}
            isSelected={isSelected}
            left={left}
            width={width}
            hasFilm={hasFilm}
            hasWave={hasWave}
            pxPerMs={pxPerMs}
            viewStartMs={viewStartMs}
            viewEndMs={viewEndMs}
            scrollRootRef={scrollRootRef}
            onClipPointerDown={onClipPointerDown}
            onWaveform={onWaveform}
          />
        )
      })}
    </div>
  )
}

interface TimelineClipBlockProps {
  clip: Clip
  asset: MediaAsset | undefined
  label: string
  tone: string
  isSelected: boolean
  left: number
  width: number
  hasFilm: boolean
  hasWave: boolean
  pxPerMs: number
  viewStartMs: number
  viewEndMs: number
  scrollRootRef: RefObject<HTMLDivElement | null>
  onClipPointerDown: (clip: Clip, event: PointerEvent) => void
  onWaveform(assetId: string, meta: WaveformMeta): void
}

function TimelineClipBlock(props: TimelineClipBlockProps) {
  const {
    clip,
    asset,
    label,
    tone,
    isSelected,
    left,
    width,
    hasFilm,
    hasWave,
    pxPerMs,
    viewStartMs,
    viewEndMs,
    scrollRootRef,
    onClipPointerDown,
    onWaveform
  } = props
  const blockRef = useRef<HTMLDivElement>(null)
  const [isInView, setInView] = useState(false)

  useEffect(
    function () {
      const el = blockRef.current
      const root = scrollRootRef.current
      if (!el) return

      const observer = new IntersectionObserver(
        function (entries) {
          const entry = entries[0]
          if (!entry) return
          setInView(entry.isIntersecting || entry.intersectionRatio > 0)
        },
        {
          root: root ?? null,
          // 提前半屏预取，滚到中心时已有图
          rootMargin: '0px 50% 0px 50%',
          threshold: 0
        }
      )
      observer.observe(el)
      return function () {
        observer.disconnect()
      }
    },
    [scrollRootRef]
  )

  return (
    <div
      ref={blockRef}
      role="button"
      tabIndex={0}
      className={clsx(
        'absolute top-1.5 flex h-[calc(100%-12px)] cursor-grab items-center overflow-hidden rounded-md border shadow-sm active:cursor-grabbing',
        tone,
        isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-background'
      )}
      style={{ left, width }}
      onPointerDown={function (event) {
        onClipPointerDown(clip, event)
      }}
      onClick={function (event) {
        event.stopPropagation()
      }}>
      {hasFilm && asset ? (
        <ClipFilmstrip
          asset={asset}
          clip={clip}
          widthPx={width}
          pxPerMs={pxPerMs}
          viewStartMs={viewStartMs}
          viewEndMs={viewEndMs}
          isInView={isInView}
        />
      ) : null}
      {hasWave && asset ? (
        <ClipWaveform
          asset={asset}
          clip={clip}
          widthPx={width}
          onWaveform={function (meta) {
            onWaveform(asset.id, meta)
          }}
        />
      ) : null}
      <span
        className={clsx(
          'relative z-[1] truncate px-2 text-[10px] font-medium',
          (hasFilm || hasWave) &&
            'rounded-sm bg-black/45 py-0.5 text-white shadow-sm backdrop-blur-[2px]'
        )}>
        {label}
      </span>
    </div>
  )
}

export { Timeline }
