import { Button } from '@i-thinking/design/components/button'
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type RefObject
} from 'react'

import { useClipchampStore } from '@/stores/clipchamp.ts'
import {
  findTrackDisplayName,
  type Clip,
  type MediaAsset,
  type Track,
  type WaveformMeta
} from '@/views/clipchamp/lib/project'
import { ClipFilmstrip, ClipWaveform } from '@/views/clipchamp/workspace/timeline/clip-thumb'
import { readPlayheadMs, subscribePlayhead } from '@/views/clipchamp/lib/playhead-clock'

const PX_PER_SECOND_BASE = 48
const TRACK_HEIGHT = 72
const RULER_LABEL_PX = 72
const RULER_MINOR_PX = 8
const RULER_STEPS_MS = [100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000]

interface RulerMark {
  ms: number
  isMajor: boolean
}

function findRulerStep(pxPerMs: number): { majorMs: number; minorMs: number } {
  const pxPerSecond = pxPerMs * 1000
  let majorMs = RULER_STEPS_MS[RULER_STEPS_MS.length - 1]
  for (const step of RULER_STEPS_MS) {
    if ((step / 1000) * pxPerSecond >= RULER_LABEL_PX) {
      majorMs = step
      break
    }
  }
  const minorMs = majorMs / 5
  const minorPx = (minorMs / 1000) * pxPerSecond
  return { majorMs, minorMs: minorPx >= RULER_MINOR_PX ? minorMs : majorMs }
}

function buildRulerMarks(
  startMs: number,
  endMs: number,
  pxPerMs: number
): { marks: RulerMark[]; majorMs: number } {
  const { majorMs, minorMs } = findRulerStep(pxPerMs)
  const from = Math.max(0, Math.floor(startMs / minorMs) * minorMs)
  const marks: RulerMark[] = []
  for (let ms = from; ms <= endMs; ms += minorMs) {
    marks.push({ ms, isMajor: ms % majorMs === 0 })
  }
  return { marks, majorMs }
}

function formatRulerLabel(ms: number, majorMs: number): string {
  const total = Math.max(0, Math.round(ms))
  const hours = Math.floor(total / 3600000)
  const minutes = Math.floor((total % 3600000) / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const tenths = Math.floor((total % 1000) / 100)
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) return `${hours}:${mm}:${ss}`
  if (majorMs < 1000) return `${mm}:${ss}.${tenths}`
  return `${mm}:${ss}`
}

function Timeline() {
  const project = useClipchampStore(function (s) {
    return s.project
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
  const { viewRange, ruler } = useTimelineViewport({ scrollRef, pxPerMs, widthPx })

  function seekFromClientX(clientX: number) {
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left + el.scrollLeft
    let ms = x / pxPerMs
    if (isSnapping) ms = Math.round(ms / 100) * 100
    seek(Math.max(0, Math.min(ms, durationMs)))
  }

  function onRulerPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    seekFromClientX(event.clientX)
  }

  function onRulerPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    seekFromClientX(event.clientX)
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
      <TimelineToolbar
        isSnapping={isSnapping}
        zoom={timelineZoom}
        onSplit={splitAtPlayhead}
        onRemove={removeSelected}
        onAddText={addTextClip}
        onImportMedia={importMedia}
        onSetSnapping={updateSnapping}
        onSetZoom={updateTimelineZoom}
      />

      <div className="flex min-h-0 flex-1">
        <TrackNameColumn
          project={project}
          tracks={project.tracks}
        />

        <div className="relative min-w-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full overflow-auto bg-[#fafafa] dark:bg-muted/10"
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
            <TimelineRuler
              ruler={ruler}
              pxPerMs={pxPerMs}
              onPointerDown={onRulerPointerDown}
              onPointerMove={onRulerPointerMove}
            />

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

          </div>
        </div>
        <PlayheadNeedle
          pxPerMs={pxPerMs}
          scrollRef={scrollRef}
        />
        </div>
      </div>
    </div>
  )
}

/** 视口范围与标尺：随滚动 / 尺寸变化分帧测量，按阈值过滤抖动 */
function useTimelineViewport(input: {
  scrollRef: RefObject<HTMLDivElement | null>
  pxPerMs: number
  widthPx: number
}) {
  const { scrollRef, pxPerMs, widthPx } = input
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
    [scrollRef, pxPerMs, widthPx]
  )

  const ruler = useMemo(
    function () {
      return buildRulerMarks(viewRange.startMs, viewRange.endMs, pxPerMs)
    },
    [viewRange.startMs, viewRange.endMs, pxPerMs]
  )

  return { viewRange, ruler }
}

function TimelineToolbar(props: {
  isSnapping: boolean
  zoom: number
  onSplit: () => void
  onRemove: () => void
  onAddText: () => void
  onImportMedia: () => void
  onSetSnapping: (value: boolean) => void
  onSetZoom: (value: number) => void
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border/80 bg-muted/10 px-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="分割 (S)"
        className="size-7 text-muted-foreground"
        onClick={props.onSplit}>
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
        onClick={props.onRemove}>
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
        onClick={props.onAddText}>
        + 文字
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={function () {
          void props.onImportMedia()
        }}>
        + 音频/媒体
      </Button>

      <div className="ml-auto flex items-center gap-0.5">
        <Button
          type="button"
          variant={props.isSnapping ? 'default' : 'ghost'}
          size="icon-sm"
          title="吸附"
          className={clsx('size-7', !props.isSnapping && 'text-muted-foreground')}
          onClick={function () {
            props.onSetSnapping(!props.isSnapping)
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
            props.onSetZoom(props.zoom / 1.25)
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
            props.onSetZoom(1)
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
            props.onSetZoom(props.zoom * 1.25)
          }}>
          <Icon
            icon="lucide:zoom-in"
            className="size-3.5"
          />
        </Button>
      </div>
    </div>
  )
}

/** 左侧轨名列：每行一个轨名字，不参与横向滚动 */
function TrackNameColumn(props: { project: Parameters<typeof findTrackDisplayName>[0]; tracks: Track[] }) {
  return (
    <div className="flex w-22 shrink-0 flex-col border-r border-border/80 bg-muted/15">
      <div className="h-7 shrink-0 border-b border-border/80" />
      {props.tracks.map(function (track) {
        return (
          <div
            key={track.id}
            className="flex items-center px-2.5 text-xs font-medium text-muted-foreground"
            style={{ height: TRACK_HEIGHT }}>
            {findTrackDisplayName(props.project, track)}
          </div>
        )
      })}
    </div>
  )
}

/** 顶部时间标尺：主刻度带文字，次刻度只画线 */
function TimelineRuler(props: {
  ruler: ReturnType<typeof buildRulerMarks>
  pxPerMs: number
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      className="sticky top-0 z-20 h-7 cursor-pointer touch-none select-none border-b border-border/80 bg-background/95 backdrop-blur-sm"
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}>
      {props.ruler.marks.map(function (mark) {
        return (
          <div
            key={mark.ms}
            className="pointer-events-none absolute bottom-0"
            style={{ left: mark.ms * props.pxPerMs }}>
            <div
              className={clsx(
                'absolute bottom-0 w-px',
                mark.isMajor ? 'h-2.5 bg-foreground/35' : 'h-1.5 bg-foreground/20'
              )}
            />
            {mark.isMajor ? (
              <span className="absolute bottom-2.5 left-1 text-xs tabular-nums leading-none text-muted-foreground">
                {formatRulerLabel(mark.ms, props.ruler.majorMs)}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

const TRACK_EMPTY_HINTS: Partial<Record<Track['kind'], string>> = {
  video: '+ 添加视频',
  audio: '+ 添加音频',
  text: '+ 添加文字',
  caption: '+ 添加字幕',
  overlay: '+ 添加叠加'
}

function findEmptyHint(kind: Track['kind']) {
  return TRACK_EMPTY_HINTS[kind] ?? null
}

const TONE_AUDIO = 'border-emerald-500/50 bg-emerald-950/80 text-emerald-50'
const TONE_TEXT = 'border-amber-500/45 bg-amber-500/25 text-amber-950 dark:text-amber-50'
const TONE_STICKER = 'border-pink-500/45 bg-pink-500/25 text-pink-950 dark:text-pink-50'
const TONE_FILM = 'border-primary/40 bg-black text-white'
const TONE_DEFAULT = 'border-primary/45 bg-primary/20 text-foreground'

function findClipTone(kind: Clip['kind'], hasFilm: boolean) {
  if (kind === 'audio') return TONE_AUDIO
  if (kind === 'text' || kind === 'caption') return TONE_TEXT
  if (kind === 'sticker') return TONE_STICKER
  return hasFilm ? TONE_FILM : TONE_DEFAULT
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
  onWaveform: (assetId: string, meta: WaveformMeta) => void
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
      style={{ height: TRACK_HEIGHT }}>
      {/* 点击空白处取消选择：用真按钮保证键盘可达，同时避开「片段不能嵌进按钮里」的非法嵌套 */}
      <button
        type="button"
        aria-label="取消选择片段"
        className="absolute inset-0 cursor-default"
        onClick={onSelectEmpty}
      />
      {track.clips.length === 0 ? (
        <div className="pointer-events-none flex h-full items-center px-3 text-xs text-muted-foreground/55">
          {findEmptyHint(track.kind)}
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
        const tone = findClipTone(clip.kind, hasFilm)

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
  onWaveform: (assetId: string, meta: WaveformMeta) => void
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
  const blockRef = useRef<HTMLButtonElement>(null)
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
    <button
      ref={blockRef}
      type="button"
      aria-pressed={isSelected}
      aria-label={label}
      className={clsx(
        'absolute top-1.5 flex h-[calc(100%-12px)] cursor-grab items-center overflow-hidden rounded-md border text-left shadow-sm active:cursor-grabbing',
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
          'relative z-1 truncate px-2 text-xs font-medium',
          (hasFilm || hasWave) &&
            'rounded-sm bg-black/45 py-0.5 text-white shadow-sm backdrop-blur-[2px]'
        )}>
        {label}
      </span>
    </button>
  )
}

function PlayheadNeedle(props: {
  pxPerMs: number
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  const playheadMs = useSyncExternalStore(subscribePlayhead, readPlayheadMs)
  const [scrollLeft, setScrollLeft] = useState(0)

  useEffect(
    function () {
      const el = props.scrollRef.current
      if (!el) return
      const scroller = el
      function sync() {
        setScrollLeft(scroller.scrollLeft)
      }
      sync()
      scroller.addEventListener('scroll', sync, { passive: true })
      return function () {
        scroller.removeEventListener('scroll', sync)
      }
    },
    [props.scrollRef]
  )

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <div
        className="absolute inset-y-0 w-0.5 bg-primary shadow-[0_0_0_1px_rgba(0,0,0,0.04)]"
        style={{ left: playheadMs * props.pxPerMs - scrollLeft }}>
        <div className="absolute -left-1.25 top-0 size-2.5 rounded-full bg-primary ring-2 ring-background" />
      </div>
    </div>
  )
}

export { Timeline }
