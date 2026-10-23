import { Button } from '@cogito/design/components/button'
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import type Konva from 'konva'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import { Group, Rect, Text as KonvaText } from 'react-konva'

import {
  CanvasStage,
  CanvasTransformer,
  MediaNode,
  findCenteredTransform,
  findContainSize,
  useMediaClock,
  type CanvasStageHandle
} from '@/lib/canvas'
import { useClipchampStore } from '@/stores/clipchamp.ts'
import {
  ASPECT_SIZE,
  findActiveClips,
  formatTimecode,
  updateClip,
  type Clip,
  type MediaAsset
} from '@/views/clipchamp/lib/project'
import { readPlayheadMs, subscribePlayhead } from '@/views/clipchamp/lib/playhead-clock'

interface PreviewProps {
  isFullscreen?: boolean
}

interface Size {
  width: number
  height: number
}

const MEDIA_SOURCE_REGISTRY = new Map<string, CanvasImageSource>()
const MEDIA_READY_LISTENERS = new Map<string, Set<() => void>>()
const PREVIEW_DRAW_LISTENERS = new Set<() => void>()

function requestPreviewDraw() {
  for (const listener of PREVIEW_DRAW_LISTENERS) listener()
}

function bindMediaSource(clipId: string, source: CanvasImageSource | null) {
  const prev = MEDIA_SOURCE_REGISTRY.get(clipId) ?? null
  if (source) MEDIA_SOURCE_REGISTRY.set(clipId, source)
  else MEDIA_SOURCE_REGISTRY.delete(clipId)
  if (prev === source) return
  const listeners = MEDIA_READY_LISTENERS.get(clipId)
  if (!listeners) return
  for (const listener of listeners) listener()
}

function findMediaSource(clipId: string): CanvasImageSource | null {
  return MEDIA_SOURCE_REGISTRY.get(clipId) ?? null
}

function useMediaSource(clipId: string): CanvasImageSource | null {
  const [source, setSource] = useState<CanvasImageSource | null>(function () {
    return findMediaSource(clipId)
  })

  useEffect(
    function () {
      function sync() {
        const next = findMediaSource(clipId)
        setSource(function (prev) {
          return prev === next ? prev : next
        })
      }
      sync()
      let bucket = MEDIA_READY_LISTENERS.get(clipId)
      if (!bucket) {
        bucket = new Set()
        MEDIA_READY_LISTENERS.set(clipId, bucket)
      }
      bucket.add(sync)
      return function () {
        bucket.delete(sync)
        if (bucket.size === 0) MEDIA_READY_LISTENERS.delete(clipId)
      }
    },
    [clipId]
  )

  return source
}

/** 仅在活动 clip 集合变化时触发 Preview 重渲染，避开 playhead 每帧刷新 Stage */
function findActiveClipIdsKey(
  project: ReturnType<typeof useClipchampStore.getState>['project'],
  playheadMs: number
) {
  return findActiveClips(project, playheadMs)
    .map(function (clip) {
      return clip.id
    })
    .join('\0')
}

/** 选中节点的快照与通知：引用稳定，供 Konva Transformer 通过 useSyncExternalStore 订阅 */
function useSelectionSnapshot(input: {
  nodeMapRef: { current: Map<string, Konva.Node> }
  selectionListenersRef: { current: Set<() => void> }
  selectedNodesSnapshotRef: { current: Konva.Node[] }
  selectedClipId: string | null
}) {
  const { nodeMapRef, selectionListenersRef, selectedNodesSnapshotRef, selectedClipId } = input

  const notifySelection = useCallback(function () {
    for (const listener of selectionListenersRef.current) listener()
  }, [selectionListenersRef])

  // 快照结果要按选中项缓存：useSyncExternalStore 要求引用稳定，所以复用 ref 里的旧数组。
  // 不能读 `selectedClipIdRef`：那要求 render 期写 ref；改成依赖 id，快照函数换新时 React 会重读。
  const getSelectedNodes = useCallback(
    function (): Konva.Node[] {
      const node = selectedClipId ? (nodeMapRef.current.get(selectedClipId) ?? null) : null
      const prev = selectedNodesSnapshotRef.current
      if (!node) {
        if (prev.length === 0) return prev
        selectedNodesSnapshotRef.current = []
        return selectedNodesSnapshotRef.current
      }
      if (prev.length === 1 && prev[0] === node) return prev
      selectedNodesSnapshotRef.current = [node]
      return selectedNodesSnapshotRef.current
    },
    [selectedClipId, nodeMapRef, selectedNodesSnapshotRef]
  )

  const subscribeSelectedNodes = useCallback(function (onStoreChange: () => void) {
    selectionListenersRef.current.add(onStoreChange)
    return function () {
      selectionListenersRef.current.delete(onStoreChange)
    }
  }, [selectionListenersRef])

  return { notifySelection, getSelectedNodes, subscribeSelectedNodes }
}

/** 舞台节点集与交互：注册、变换提交、选中快照都收敛在这里，对外引用保持稳定 */
function usePreviewNodes(input: {
  nodeMapRef: { current: Map<string, Konva.Node> }
  selectedClipIdRef: { current: string | null }
  selectClipRef: { current: (clipId: string | null) => void }
  undoCapturedRef: { current: boolean }
  selectionListenersRef: { current: Set<() => void> }
  selectedNodesSnapshotRef: { current: Konva.Node[] }
  selectedClipId: string | null
  mediaClips: Clip[]
  contentClips: Clip[]
  assetMap: Map<string, MediaAsset>
  contentSize: Size
}) {
  const {
    nodeMapRef,
    selectedClipIdRef,
    selectClipRef,
    undoCapturedRef,
    selectionListenersRef,
    selectedNodesSnapshotRef,
    selectedClipId,
    mediaClips,
    contentClips,
    assetMap,
    contentSize
  } = input

  const { notifySelection, getSelectedNodes, subscribeSelectedNodes } = useSelectionSnapshot({
    nodeMapRef,
    selectionListenersRef,
    selectedNodesSnapshotRef,
    selectedClipId
  })

  // 稳定引用：仅写 nodeMap + 通知 Transformer；禁止 setState 抬升 Stage 宿主
  // unregister 带旧节点：remount 同 tick 时，新 register 先写入后旧 cleanup 不会误清
  const registerNode = useCallback(function (
    clipId: string,
    node: Konva.Node | null,
    unmounting?: Konva.Node | null
  ) {
    const prev = nodeMapRef.current.get(clipId) ?? null
    if (node) {
      nodeMapRef.current.set(clipId, node)
    } else if (unmounting !== undefined && unmounting !== null) {
      if (nodeMapRef.current.get(clipId) !== unmounting) return
      nodeMapRef.current.delete(clipId)
    } else {
      nodeMapRef.current.delete(clipId)
    }
    const next = nodeMapRef.current.get(clipId) ?? null
    if (clipId !== selectedClipIdRef.current || prev === next) return
    notifySelection()
  }, [nodeMapRef, selectedClipIdRef, notifySelection])

  const beginTransform = useCallback(function () {
    if (undoCapturedRef.current) return
    useClipchampStore.getState().captureUndoPoint()
    undoCapturedRef.current = true
  }, [undoCapturedRef])

  const endTransform = useCallback(function (clipId: string, node: Konva.Node) {
    const store = useClipchampStore.getState()
    const size = ASPECT_SIZE[store.canvasAspect ?? store.project.aspect]
    store.applyLive(function (draft) {
      return updateClip(draft, clipId, {
        x: node.x() / size.width,
        y: node.y() / size.height,
        scale: Math.abs(node.scaleX()),
        rotation: node.rotation()
      })
    })
    undoCapturedRef.current = false
  }, [undoCapturedRef])

  const handleSelectClip = useCallback(function (clipId: string) {
    selectClipRef.current(clipId)
  }, [selectClipRef])

  const handleStageClick = useCallback(function (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>
  ) {
    if (event.target === event.target.getStage()) {
      selectClipRef.current(null)
    }
  }, [selectClipRef])

  const handleTransformEnd = useCallback(function () {
    const store = useClipchampStore.getState()
    const clipId = store.selectedClipId
    if (!clipId) return
    const attached = nodeMapRef.current.get(clipId)
    if (!attached) return
    endTransform(clipId, attached)
  }, [nodeMapRef, endTransform])

  const mediaNodes = useMemo(
    function () {
      const top = mediaClips.length
      return mediaClips.map(function (clip, index) {
        return (
          <PreviewMediaClip
            key={clip.id}
            clip={clip}
            asset={clip.assetId ? assetMap.get(clip.assetId) : undefined}
            contentSize={contentSize}
            zIndex={top - index}
            onRegister={registerNode}
            onSelect={handleSelectClip}
            onTransformStart={beginTransform}
            onTransformCommit={endTransform}
          />
        )
      })
    },
    [
      mediaClips,
      assetMap,
      contentSize,
      registerNode,
      handleSelectClip,
      beginTransform,
      endTransform
    ]
  )

  const contentNodes = useMemo(
    function () {
      const top = contentClips.length
      return contentClips.map(function (clip, index) {
        return (
          <PreviewTextClip
            key={clip.id}
            clip={clip}
            contentSize={contentSize}
            zIndex={top - index}
            onRegister={registerNode}
            onSelect={handleSelectClip}
            onTransformStart={beginTransform}
            onTransformCommit={endTransform}
          />
        )
      })
    },
    [contentClips, contentSize, registerNode, handleSelectClip, beginTransform, endTransform]
  )

  const interactionNode = useMemo(
    function () {
      return (
        <CanvasTransformer
          getNodes={getSelectedNodes}
          subscribeNodes={subscribeSelectedNodes}
          rotateEnabled
          onTransformEnd={handleTransformEnd}
        />
      )
    },
    [getSelectedNodes, subscribeSelectedNodes, handleTransformEnd]
  )

  return {
    notifySelection,
    handleStageClick,
    mediaNodes,
    contentNodes,
    interactionNode
  }
}

function Preview(props: PreviewProps) {
  const { isFullscreen } = props
  const project = useClipchampStore(function (s) {
    return s.project
  })
  const assets = useClipchampStore(function (s) {
    return s.assets
  })
  const isPlaying = useClipchampStore(function (s) {
    return s.isPlaying
  })
  const selectedClipId = useClipchampStore(function (s) {
    return s.selectedClipId
  })
  const selectClip = useClipchampStore(function (s) {
    return s.selectClip
  })
  const updateFullscreen = useClipchampStore(function (s) {
    return s.updateFullscreen
  })
  const activeIdsKey = useClipchampStore(function (s) {
    return findActiveClipIdsKey(s.project, s.playheadMs)
  })

  const canvasAspect = useClipchampStore(function (s) {
    return s.canvasAspect
  })
  const contentSize = ASPECT_SIZE[canvasAspect ?? project.aspect]
  const stageHandleRef = useRef<CanvasStageHandle>(null)
  const viewportHostRef = useRef<HTMLDivElement>(null)
  const nodeMapRef = useRef(new Map<string, Konva.Node>())
  const selectedClipIdRef = useRef(selectedClipId)
  const selectClipRef = useRef(selectClip)
  const selectedNodesSnapshotRef = useRef<Konva.Node[]>([])
  const selectionListenersRef = useRef(new Set<() => void>())
  const [stageNode, setStageNode] = useState<Konva.Stage | null>(null)
  const [viewport, setViewport] = useState<Size>({ width: 1, height: 1 })
  const undoCapturedRef = useRef(false)

  useEffect(function () {
    const host = viewportHostRef.current
    if (!host) return

    function measure(entries?: ResizeObserverEntry[]) {
      const el = viewportHostRef.current
      if (!el) return
      const entry = entries?.[0]
      const box = entry?.contentBoxSize?.[0]
      // 优先 client*：flex 未撑开时 contentBox 常为 0，避免 1×1 伪视口
      const width = Math.max(
        0,
        Math.floor(box?.inlineSize || el.clientWidth || el.getBoundingClientRect().width)
      )
      const height = Math.max(
        0,
        Math.floor(box?.blockSize || el.clientHeight || el.getBoundingClientRect().height)
      )
      setViewport(function (prev) {
        if (prev.width === width && prev.height === height) return prev
        return { width, height }
      })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return function () {
      observer.disconnect()
    }
  }, [])

  const frameSize = useMemo(
    function () {
      return findContainSize(viewport, contentSize)
    },
    [viewport, contentSize]
  )
  const hasViewport = viewport.width >= 8 && viewport.height >= 8

  const activeClips = useMemo(
    function () {
      // activeIdsKey 仅在依赖里承担「活跃集合变了就重算」的信号，不参与计算
      void activeIdsKey
      return findActiveClips(project, readPlayheadMs())
    },
    [project, activeIdsKey]
  )

  const assetMap = useMemo(
    function () {
      const map = new Map<string, MediaAsset>()
      for (const asset of assets) map.set(asset.id, asset)
      return map
    },
    [assets]
  )

  const trackOrder = useMemo(
    function () {
      const map = new Map<string, number>()
      project.tracks.forEach(function (track, index) {
        map.set(track.id, index)
      })
      return map
    },
    [project.tracks]
  )

  const mediaClips = useMemo(
    function () {
      return activeClips
        .filter(function (clip) {
          return clip.kind === 'video' || clip.kind === 'image'
        })
        .sort(function (a, b) {
          return (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0)
        })
    },
    [activeClips, trackOrder]
  )

  const contentClips = useMemo(
    function () {
      return activeClips
        .filter(function (clip) {
          return clip.kind === 'text' || clip.kind === 'caption' || clip.kind === 'sticker'
        })
        .sort(function (a, b) {
          return (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0)
        })
    },
    [activeClips, trackOrder]
  )

  const audioClips = useMemo(
    function () {
      return activeClips.filter(function (clip) {
        return clip.kind === 'audio'
      })
    },
    [activeClips]
  )

  const backgroundNode = useMemo(
    function () {
      return (
        <Rect
          x={0}
          y={0}
          width={contentSize.width}
          height={contentSize.height}
          fill="#000000"
          listening={false}
        />
      )
    },
    [contentSize.width, contentSize.height]
  )

  useLayoutEffect(
    function () {
      setStageNode(stageHandleRef.current?.stage ?? null)
    },
    [hasViewport, frameSize.width, frameSize.height, activeIdsKey]
  )

  useMediaClock({ active: isPlaying, target: stageNode })

  useEffect(function () {
    function draw() {
      stageHandleRef.current?.batchDraw()
    }
    PREVIEW_DRAW_LISTENERS.add(draw)
    return function () {
      PREVIEW_DRAW_LISTENERS.delete(draw)
    }
  }, [])

  const { notifySelection, handleStageClick, mediaNodes, contentNodes, interactionNode } =
    usePreviewNodes({
      nodeMapRef,
      selectedClipIdRef,
      selectClipRef,
      undoCapturedRef,
      selectionListenersRef,
      selectedNodesSnapshotRef,
      selectedClipId,
      mediaClips,
      contentClips,
      assetMap,
      contentSize
    })

  // 选区变更只通知 Konva 内 Transformer（useSyncExternalStore），不抬升 Preview setState。
  // ref 同步也放这里：render 期写 ref 会被 React 19 判为「渲染期改 ref」。
  useLayoutEffect(
    function () {
      selectedClipIdRef.current = selectedClipId
      selectClipRef.current = selectClip
      notifySelection()
    },
    [selectedClipId, selectClip, notifySelection]
  )

  return (
    <div
      className={clsx(
        'flex h-full min-h-0 w-full flex-1 flex-col',
        isFullscreen ? 'bg-black' : 'bg-[#f3f4f6] dark:bg-muted/30'
      )}>
      <div
        ref={viewportHostRef}
        className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center p-4">
        {hasViewport ? (
          <div
            className="relative overflow-hidden rounded-md bg-black shadow-[0_8px_30px_rgb(0,0,0,0.18)] ring-1 ring-black/10"
            style={{ width: frameSize.width, height: frameSize.height }}>
            <CanvasStage
              ref={stageHandleRef}
              contentSize={contentSize}
              viewSize={frameSize}
              mediaListening
              contentListening
              background={backgroundNode}
              media={mediaNodes}
              content={contentNodes}
              interaction={interactionNode}
              onStageClick={handleStageClick}
            />

            {activeClips.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                <Icon
                  icon="lucide:clapperboard"
                  className="size-8 text-white/35"
                />
                <p className="text-sm text-white/55">将媒体拖到时间轴开始编辑</p>
              </div>
            )}

            <div className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0">
              {mediaClips.map(function (clip) {
                const asset = clip.assetId ? assetMap.get(clip.assetId) : undefined
                if (!asset) return null
                return (
                  <OffscreenMedia
                    key={`src-${clip.id}`}
                    clip={clip}
                    asset={asset}
                  />
                )
              })}
              {audioClips.map(function (clip) {
                const asset = clip.assetId ? assetMap.get(clip.assetId) : undefined
                if (!asset) return null
                return (
                  <OffscreenAudio
                    key={`audio-${clip.id}`}
                    clip={clip}
                    asset={asset}
                  />
                )
              })}
            </div>
          </div>
        ) : null}
      </div>

      <PreviewTransport
        isFullscreen={isFullscreen}
        onExitFullscreen={updateFullscreen}
      />
    </div>
  )
}

interface PreviewTransportProps {
  isFullscreen?: boolean
  onExitFullscreen: (value: boolean) => void
}

function PreviewTransport(props: PreviewTransportProps) {
  const { isFullscreen, onExitFullscreen } = props
  const playheadMs = useSyncExternalStore(subscribePlayhead, readPlayheadMs)
  const isPlaying = useClipchampStore(function (s) {
    return s.isPlaying
  })
  const durationMs = useClipchampStore(function (s) {
    return s.project.durationMs
  })
  const togglePlay = useClipchampStore(function (s) {
    return s.togglePlay
  })
  const seek = useClipchampStore(function (s) {
    return s.seek
  })
  const splitAtPlayhead = useClipchampStore(function (s) {
    return s.splitAtPlayhead
  })

  return (
    <div className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-border/80 bg-background/90 px-3 backdrop-blur-sm">
      <div className="flex items-center justify-start">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="分割"
          className="size-8 text-muted-foreground"
          onClick={function () {
            splitAtPlayhead()
          }}>
          <Icon
            icon="lucide:scissors"
            className="size-4"
          />
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="后退 1 秒"
          className="size-8 text-muted-foreground"
          onClick={function () {
            seek(Math.max(0, playheadMs - 1000))
          }}>
          <Icon
            icon="lucide:rewind"
            className="size-4"
          />
        </Button>
        <Button
          type="button"
          variant="default"
          size="icon-sm"
          title={isPlaying ? '暂停' : '播放'}
          className="size-9 rounded-full shadow-sm"
          onClick={function () {
            togglePlay()
          }}>
          <Icon
            icon={isPlaying ? 'lucide:pause' : 'lucide:play'}
            className={clsx('size-4', !isPlaying && 'translate-x-px')}
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="快进 1 秒"
          className="size-8 text-muted-foreground"
          onClick={function () {
            seek(Math.min(durationMs, playheadMs + 1000))
          }}>
          <Icon
            icon="lucide:fast-forward"
            className="size-4"
          />
        </Button>
      </div>

      <div className="flex items-center justify-end gap-2">
        <span className="min-w-30 text-right font-mono text-xs tabular-nums text-muted-foreground">
          {formatTimecode(playheadMs)} / {formatTimecode(durationMs)}
        </span>
        {isFullscreen ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={function () {
              onExitFullscreen(false)
            }}>
            退出全屏
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function findAnimState(clip: Clip, playheadMs: number) {
  const clipLocalMs = playheadMs - clip.startMs
  const clipSpanMs = clip.durationMs / Math.max(0.1, clip.speed)
  let animOpacity = 1
  let animScale = 1
  let animY = 0
  if (
    clip.enterAnim.kind !== 'none' &&
    clip.enterAnim.durationMs > 0 &&
    clipLocalMs < clip.enterAnim.durationMs
  ) {
    const t = clipLocalMs / clip.enterAnim.durationMs
    if (clip.enterAnim.kind === 'fade') animOpacity = t
    if (clip.enterAnim.kind === 'zoom') animScale = 0.7 + 0.3 * t
    if (clip.enterAnim.kind === 'slide-up') animY = (1 - t) * 40
  }
  if (
    clip.exitAnim.kind !== 'none' &&
    clip.exitAnim.durationMs > 0 &&
    clipLocalMs > clipSpanMs - clip.exitAnim.durationMs
  ) {
    const t = (clipSpanMs - clipLocalMs) / clip.exitAnim.durationMs
    if (clip.exitAnim.kind === 'fade') animOpacity = Math.min(animOpacity, t)
    if (clip.exitAnim.kind === 'zoom') animScale *= 0.7 + 0.3 * t
    if (clip.exitAnim.kind === 'slide-down') animY += (1 - t) * 40
  }
  if (clip.fadeInMs > 0 && clipLocalMs < clip.fadeInMs) {
    animOpacity *= clipLocalMs / clip.fadeInMs
  }
  if (clip.fadeOutMs > 0 && clipLocalMs > clipSpanMs - clip.fadeOutMs) {
    animOpacity *= (clipSpanMs - clipLocalMs) / clip.fadeOutMs
  }
  return { animOpacity, animScale, animY }
}

interface OffscreenMediaProps {
  clip: Clip
  asset: MediaAsset
}

function findLocalTime(clip: Clip): number {
  return ((readPlayheadMs() - clip.startMs) * Math.max(0.1, clip.speed) + clip.sourceInMs) / 1000
}

function OffscreenMedia(props: OffscreenMediaProps) {
  const { clip, asset } = props
  const isPlaying = useClipchampStore(function (s) {
    return s.isPlaying
  })
  const videoRef = useRef<HTMLVideoElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const isImage = asset.kind === 'image' || clip.kind === 'image'

  useEffect(
    function () {
      if (isImage) {
        const img = imageRef.current
        if (!img) return
        bindMediaSource(clip.id, img)
        return function () {
          bindMediaSource(clip.id, null)
        }
      }
      const video = videoRef.current
      if (!video) return
      bindMediaSource(clip.id, video)
      return function () {
        bindMediaSource(clip.id, null)
      }
    },
    [clip.id, isImage]
  )

  useEffect(
    function () {
      if (isImage) return
      const video = videoRef.current
      if (!video) return
      const media = video

      function place(force: boolean) {
        const localTime = findLocalTime(clip)
        const drift = Math.abs(media.currentTime - localTime)
        if (!force && drift <= 0.45) return
        try {
          media.currentTime = localTime
        } catch (error) {
          console.debug('[clipchamp] video seek skipped', error)
        }
        if (Math.abs(media.currentTime - localTime) < 0.05) requestPreviewDraw()
      }

      function onSeeked() {
        requestPreviewDraw()
      }

      video.playbackRate = clip.speed
      video.volume = Math.min(1, Math.max(0, clip.volume))
      video.muted = clip.volume <= 0
      video.addEventListener('seeked', onSeeked)
      place(!isPlaying)
      if (isPlaying) {
        void video.play().catch(function () {})
      } else {
        video.pause()
      }
      const unsubscribe = subscribePlayhead(function () {
        place(!isPlaying)
      })
      return function () {
        unsubscribe()
        video.removeEventListener('seeked', onSeeked)
        video.pause()
      }
    },
    [isPlaying, clip, isImage]
  )

  if (isImage) {
    return (
      <img
        ref={imageRef}
        src={asset.thumbUrl}
        alt=""
        onLoad={function () {
          if (imageRef.current) bindMediaSource(clip.id, imageRef.current)
        }}
      />
    )
  }

  return (
    <video
      ref={videoRef}
      src={asset.thumbUrl}
      muted={clip.volume <= 0}
      playsInline
      preload="auto"
      onLoadedData={function () {
        if (videoRef.current) bindMediaSource(clip.id, videoRef.current)
      }}
    />
  )
}

interface OffscreenAudioProps {
  clip: Clip
  asset: MediaAsset
}

function OffscreenAudio(props: OffscreenAudioProps) {
  const { clip, asset } = props
  const isPlaying = useClipchampStore(function (s) {
    return s.isPlaying
  })
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(
    function () {
      const audio = audioRef.current
      if (!audio) return
      const media = audio

      function place(force: boolean) {
        const localTime = findLocalTime(clip)
        const drift = Math.abs(media.currentTime - localTime)
        if (!force && drift <= 0.45) return
        try {
          media.currentTime = localTime
        } catch (error) {
          console.debug('[clipchamp] audio seek skipped', error)
        }
      }

      audio.playbackRate = clip.speed
      audio.volume = Math.min(1, Math.max(0, clip.volume))
      place(!isPlaying)
      if (isPlaying) {
        void audio.play().catch(function () {})
      } else {
        audio.pause()
      }
      const unsubscribe = subscribePlayhead(function () {
        place(!isPlaying)
      })
      return function () {
        unsubscribe()
        audio.pause()
      }
    },
    [isPlaying, clip]
  )

  return (
    <audio
      ref={audioRef}
      src={asset.thumbUrl}
      preload="auto"
    />
  )
}

type RegisterNode = (
  clipId: string,
  node: Konva.Node | null,
  unmounting?: Konva.Node | null
) => void

interface PreviewMediaClipProps {
  clip: Clip
  asset?: MediaAsset
  contentSize: Size
  zIndex: number
  onRegister: RegisterNode
  onSelect: (clipId: string) => void
  onTransformStart: () => void
  onTransformCommit: (clipId: string, node: Konva.Node) => void
}

const PreviewMediaClip = memo(function PreviewMediaClip(props: PreviewMediaClipProps) {
  const { clip, asset, contentSize, onRegister, onSelect, onTransformStart, onTransformCommit } =
    props
  const playheadMs = useSyncExternalStore(subscribePlayhead, readPlayheadMs)
  const groupRef = useRef<Konva.Group>(null)
  const source = useMediaSource(clip.id)
  const { animOpacity, animScale, animY } = findAnimState(clip, playheadMs)

  useEffect(
    function () {
      const node = groupRef.current
      if (!node) return
      onRegister(clip.id, node)
      return function () {
        onRegister(clip.id, null, node)
      }
    },
    [clip.id, onRegister]
  )

  const mediaW =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth
        : asset?.width
  const mediaH =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight
        : asset?.height

  const transform = findCenteredTransform({
    contentWidth: contentSize.width,
    contentHeight: contentSize.height,
    x: clip.x,
    y: clip.y,
    scale: clip.scale,
    rotation: clip.rotation,
    mediaWidth: mediaW && mediaW > 0 ? mediaW : undefined,
    mediaHeight: mediaH && mediaH > 0 ? mediaH : undefined
  })

  const opacity =
    clip.opacity * animOpacity * (1 - Math.min(1, Math.max(0, clip.filter.transparency)))

  const maskKind = clip.mask.kind
  const clipW = transform.width
  const clipH = transform.height
  const clipFunc = useMemo(
    function () {
      if (maskKind === 'none') return undefined
      return function (ctx: Konva.Context) {
        if (maskKind === 'circle') {
          ctx.beginPath()
          ctx.arc(0, 0, Math.min(clipW, clipH) / 2, 0, Math.PI * 2, false)
          ctx.closePath()
          return
        }
        if (maskKind === 'rounded') {
          const r = Math.min(clipW, clipH) * 0.18
          ctx.beginPath()
          ctx.moveTo(-clipW / 2 + r, -clipH / 2)
          ctx.arcTo(clipW / 2, -clipH / 2, clipW / 2, clipH / 2, r)
          ctx.arcTo(clipW / 2, clipH / 2, -clipW / 2, clipH / 2, r)
          ctx.arcTo(-clipW / 2, clipH / 2, -clipW / 2, -clipH / 2, r)
          ctx.arcTo(-clipW / 2, -clipH / 2, clipW / 2, -clipH / 2, r)
          ctx.closePath()
          return
        }
        ctx.beginPath()
        ctx.rect(-clipW / 2, -clipH / 2, clipW, clipH)
        ctx.closePath()
      }
    },
    [maskKind, clipW, clipH]
  )

  return (
    <Group
      ref={groupRef}
      id={clip.id}
      name={`media-${clip.id}`}
      x={transform.x}
      y={transform.y}
      scaleX={transform.scaleX}
      scaleY={transform.scaleY}
      rotation={transform.rotation}
      opacity={opacity}
      clipFunc={clipFunc}
      draggable
      listening
      onClick={function (event) {
        event.cancelBubble = true
        onSelect(clip.id)
      }}
      onTap={function (event) {
        event.cancelBubble = true
        onSelect(clip.id)
      }}
      onDragStart={onTransformStart}
      onDragEnd={function (event) {
        onTransformCommit(clip.id, event.target)
      }}
      onTransformStart={onTransformStart}
      onTransformEnd={function (event) {
        onTransformCommit(clip.id, event.target)
      }}>
      <Group
        scaleX={animScale}
        scaleY={animScale}
        y={animY}
        listening={false}>
        <MediaNode
          source={source}
          width={transform.width}
          height={transform.height}
          offsetX={transform.offsetX}
          offsetY={transform.offsetY}
          listening={false}
          grade={clip.filter}
        />
      </Group>
    </Group>
  )
})

interface PreviewTextClipProps {
  clip: Clip
  contentSize: Size
  zIndex: number
  onRegister: RegisterNode
  onSelect: (clipId: string) => void
  onTransformStart: () => void
  onTransformCommit: (clipId: string, node: Konva.Node) => void
}

const PreviewTextClip = memo(function PreviewTextClip(props: PreviewTextClipProps) {
  const { clip, contentSize, onRegister, onSelect, onTransformStart, onTransformCommit } = props
  const playheadMs = useSyncExternalStore(subscribePlayhead, readPlayheadMs)
  const textRef = useRef<Konva.Text>(null)
  const { animOpacity, animScale, animY } = findAnimState(clip, playheadMs)
  const fontSize = clip.text?.fontSize || 48
  const content = clip.text?.content || ''

  useEffect(
    function () {
      const node = textRef.current
      if (!node) return
      onRegister(clip.id, node)
      return function () {
        onRegister(clip.id, null, node)
      }
    },
    [clip.id, onRegister]
  )

  useEffect(
    function () {
      const node = textRef.current
      if (!node) return
      node.offsetX(node.width() / 2)
      node.offsetY(node.height() / 2)
    },
    [content, fontSize, clip.scale]
  )

  return (
    <KonvaText
      ref={textRef}
      id={clip.id}
      name={`text-${clip.id}`}
      text={content}
      fontSize={fontSize}
      fontStyle={String(clip.text?.fontWeight || 700)}
      fill={clip.text?.color || '#ffffff'}
      align={clip.text?.align || 'center'}
      x={clip.x * contentSize.width}
      y={clip.y * contentSize.height + animY}
      scaleX={clip.scale * animScale}
      scaleY={clip.scale * animScale}
      rotation={clip.rotation}
      opacity={clip.opacity * animOpacity}
      listening
      draggable
      onClick={function (event) {
        event.cancelBubble = true
        onSelect(clip.id)
      }}
      onTap={function (event) {
        event.cancelBubble = true
        onSelect(clip.id)
      }}
      onDragStart={onTransformStart}
      onDragEnd={function (event) {
        onTransformCommit(clip.id, event.target)
      }}
      onTransformStart={onTransformStart}
      onTransformEnd={function (event) {
        onTransformCommit(clip.id, event.target)
      }}
    />
  )
})

export { Preview }
