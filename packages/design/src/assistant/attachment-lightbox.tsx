/**
 * Composer / 用户消息图片预览：对齐图库 MediaLightbox 的观感
 * （深色遮罩、圆角卡片、悬浮圆形关闭、左右切图）。
 *
 * 弹层尺寸按图片天然宽高比 contain，避免继承 Dialog `w-full` 后
 * 竖图（如侧栏浏览器截图）两侧留出大片空白、看起来比例错了。
 *
 * 舞台的缩放口径与图库一致：100% = contain 后的尺寸，滚轮 / 双击 / 按钮
 * 都能缩放，放大后可拖动平移。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'

import { Button } from '../components/button'
import { Dialog, DialogContent, DialogTitle } from '../components/dialog'
import {
  clampPan,
  containSize,
  fitViewport,
  VIEWPORT_WHEEL_FACTOR,
  zoomAtPointer,
  type Size,
  type Viewport
} from './attachment-layout'
import { useAssistantLabels } from './labels'

interface AttachmentLightboxMedia {
  id: string
  src: string
  fileName: string
}

interface AttachmentLightboxApi {
  open(id: string): void
}

interface FrameSize {
  width: number
  height: number
}

const HEADER_Y = 44
const FRAME_VW = 0.92
const FRAME_VH = 0.88
const FALLBACK_ASPECT = 16 / 10
/** 舞台内边距：contain 的基准区域是舞台去掉这一圈之后的矩形 */
const STAGE_PAD = 8
/** 点一下 +/− 的倍率 */
const ZOOM_BUTTON_STEP = 1.25
/** 被视作「就是 100%」的浮点容差 */
const ZOOM_EPSILON = 1.001

const AttachmentLightboxContext = createContext<AttachmentLightboxApi | null>(null)

function useAttachmentLightbox() {
  return useContext(AttachmentLightboxContext)
}

function findAttachmentFrame(aspect: number): FrameSize {
  if (typeof window === 'undefined') {
    return { width: 640, height: 440 }
  }
  const maxW = window.innerWidth * FRAME_VW
  const maxH = window.innerHeight * FRAME_VH
  const stageMaxH = Math.max(160, maxH - HEADER_Y)
  let stageW = maxW
  let stageH = stageW / aspect
  if (stageH > stageMaxH) {
    stageH = stageMaxH
    stageW = stageH * aspect
  }
  return {
    width: Math.round(Math.max(240, stageW)),
    height: Math.round(Math.max(160, stageH) + HEADER_Y)
  }
}

/**
 * 读 naturalWidth/Height：既把弹层收成图片 contain 后的外框，
 * 也把真实像素尺寸交给舞台算缩放。
 */
function useAttachmentLightboxFrame(
  src: string | undefined,
  open: boolean
): { frame: FrameSize; natural: Size | null } {
  // 记「哪一串 src 解码出了多大」：换图时旧尺寸自动失效，不必在 effect 里 setState
  const [loaded, updateLoaded] = useState<{ src: string; size: Size } | null>(null)
  const [frame, updateFrame] = useState<FrameSize>(function () {
    return findAttachmentFrame(FALLBACK_ASPECT)
  })

  useEffect(
    function () {
      if (!open || !src) return
      let cancelled = false
      const image = new Image()
      image.decoding = 'async'
      image.onload = function () {
        if (cancelled) return
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          updateLoaded({ src, size: { width: image.naturalWidth, height: image.naturalHeight } })
        }
      }
      image.onerror = function () {
        if (cancelled) return
        // 解码失败：沿用兜底比例（外框按 16:10，图片自己走 contain）
      }
      image.src = src
      return function () {
        cancelled = true
      }
    },
    [open, src]
  )

  const natural = loaded && loaded.src === src ? loaded.size : null
  const aspect = natural ? natural.width / natural.height : FALLBACK_ASPECT

  useLayoutEffect(
    function () {
      if (!open) return
      function syncFrame() {
        updateFrame(findAttachmentFrame(aspect))
      }
      syncFrame()
      window.addEventListener('resize', syncFrame)
      return function () {
        window.removeEventListener('resize', syncFrame)
      }
    },
    [open, aspect]
  )

  return { frame, natural }
}

/** 缩放条 / 切图按钮上的手势不要冒到舞台，否则会被当成拖拽平移 */
function stopPointerEvent(event: React.SyntheticEvent) {
  event.stopPropagation()
}

function LightboxNavButton(props: {
  label: string
  side: 'left' | 'right'
  disabled: boolean
  onClick: () => void
}) {
  const isLeft = props.side === 'left'
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={props.label}
      disabled={props.disabled}
      onPointerDown={stopPointerEvent}
      className={cn(
        'absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full',
        'border border-white/15 bg-black/40 text-white shadow-lg backdrop-blur-md',
        'transition-[background-color,transform,opacity] duration-200',
        'hover:bg-black/60 hover:scale-105 active:scale-95',
        'disabled:pointer-events-none disabled:opacity-25',
        'focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none',
        isLeft ? 'left-3' : 'right-3'
      )}
      onClick={props.onClick}>
      <Icon
        icon={isLeft ? 'lucide:chevron-left' : 'lucide:chevron-right'}
        className="size-5"
      />
    </Button>
  )
}

/** 舞台右下角的缩放条：缩小 / 当前倍率（点击复位）/ 放大 */
function LightboxZoomBar(props: {
  scale: number
  disabled: boolean
  onZoom: (factor: number) => void
  onReset: () => void
}) {
  const labels = useAssistantLabels()
  return (
    <div
      className={cn(
        'absolute end-3 bottom-3 z-10 flex items-center gap-0.5 rounded-full border border-white/15',
        'bg-black/45 p-0.5 text-white shadow-lg backdrop-blur-md'
      )}
      onPointerDown={stopPointerEvent}
      onDoubleClick={stopPointerEvent}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={labels.zoomOut}
        disabled={props.disabled || props.scale <= ZOOM_EPSILON}
        className="size-7 rounded-full text-white hover:bg-white/15 hover:text-white disabled:opacity-35"
        onClick={function () {
          props.onZoom(1 / ZOOM_BUTTON_STEP)
        }}>
        <Icon
          icon="lucide:minus"
          className="size-4"
        />
      </Button>
      <button
        type="button"
        aria-label={labels.zoomReset}
        className="min-w-10 cursor-pointer rounded-full px-1 text-center text-xs tabular-nums opacity-90 hover:opacity-100"
        onClick={props.onReset}>
        {Math.round(props.scale * 100)}%
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={labels.zoomIn}
        disabled={props.disabled}
        className="size-7 rounded-full text-white hover:bg-white/15 hover:text-white disabled:opacity-35"
        onClick={function () {
          props.onZoom(ZOOM_BUTTON_STEP)
        }}>
        <Icon
          icon="lucide:plus"
          className="size-4"
        />
      </Button>
    </div>
  )
}

/**
 * 预览舞台：图片按天然比例 contain，滚轮以指针为锚缩放，放大后可拖动，
 * 双击回到 100%。
 */
function AttachmentZoomStage(props: {
  src: string
  fileName: string
  natural: Size | null
  showNav: boolean
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<Viewport>({ scale: 1, x: 0, y: 0 })
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const [viewport, updateViewport] = useState<Viewport>(viewportRef.current)
  const [view, updateView] = useState<Size>({ width: 1, height: 1 })
  const natural = props.natural

  const commit = useCallback(function (next: Viewport) {
    viewportRef.current = next
    updateViewport(next)
  }, [])

  // 舞台尺寸自己量：窗口缩放、切到全屏都要重算 contain
  useLayoutEffect(function () {
    const host = hostRef.current
    if (!host) return
    function measure() {
      const el = hostRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      updateView({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return function () {
      observer.disconnect()
    }
  }, [])

  // 换图：缩放回到 100%（新尺寸到位后再居中，见下一个 effect）
  useLayoutEffect(
    function () {
      viewportRef.current = { scale: 1, x: 0, y: 0 }
      updateViewport(viewportRef.current)
      dragRef.current = null
    },
    [props.src]
  )

  const bounds = useMemo<Size>(
    function () {
      return {
        width: Math.max(1, view.width - STAGE_PAD * 2),
        height: Math.max(1, view.height - STAGE_PAD * 2)
      }
    },
    [view.width, view.height]
  )

  const fit = useMemo(
    function () {
      if (!natural) return null
      const size = containSize(bounds, natural)
      return size.width > 0 && size.height > 0 ? size : null
    },
    [bounds, natural]
  )

  // 尺寸 / 图片比例变化：100% 重新居中，已放大则只重新钳制平移
  useLayoutEffect(
    function () {
      if (!natural) return
      const current = viewportRef.current
      const next =
        current.scale <= ZOOM_EPSILON
          ? fitViewport(bounds, natural)
          : clampPan(current, bounds, natural)
      viewportRef.current = next
      updateViewport(next)
    },
    [natural, bounds]
  )

  // 滚轮缩放：React 的 onWheel 挂在 root 上是 passive，必须自己绑
  useEffect(
    function () {
      const host = hostRef.current
      if (!host || !natural) return
      // 收窄后的值要传进闭包，回调里再读 ref.current 会丢类型收窄（TS18047）
      return bindWheel(host, natural)

      function bindWheel(stage: HTMLElement, content: Size) {
        function onWheel(event: WheelEvent) {
          event.preventDefault()
          const rect = stage.getBoundingClientRect()
          const inner = {
            width: Math.max(1, rect.width - STAGE_PAD * 2),
            height: Math.max(1, rect.height - STAGE_PAD * 2)
          }
          const pointer = {
            x: event.clientX - rect.left - STAGE_PAD,
            y: event.clientY - rect.top - STAGE_PAD
          }
          const factor = event.deltaY > 0 ? 1 / VIEWPORT_WHEEL_FACTOR : VIEWPORT_WHEEL_FACTOR
          commit(clampPan(zoomAtPointer(viewportRef.current, pointer, factor), inner, content))
        }
        stage.addEventListener('wheel', onWheel, { passive: false })
        return function () {
          stage.removeEventListener('wheel', onWheel)
        }
      }
    },
    [commit, natural]
  )

  const reset = useCallback(
    function () {
      commit(natural ? fitViewport(bounds, natural) : { scale: 1, x: 0, y: 0 })
    },
    [bounds, commit, natural]
  )

  const zoomStep = useCallback(
    function (factor: number) {
      if (!natural) return
      const anchor = { x: bounds.width / 2, y: bounds.height / 2 }
      commit(clampPan(zoomAtPointer(viewportRef.current, anchor, factor), bounds, natural))
    },
    [bounds, commit, natural]
  )

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || viewportRef.current.scale <= ZOOM_EPSILON) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewportRef.current.x,
      originY: viewportRef.current.y
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !natural) return
    commit(
      clampPan(
        {
          scale: viewportRef.current.scale,
          x: drag.originX + (event.clientX - drag.startX),
          y: drag.originY + (event.clientY - drag.startY)
        },
        bounds,
        natural
      )
    )
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch (error) {
      console.debug('[attachment-lightbox] releasePointerCapture skipped', error)
    }
  }

  const isZoomed = viewport.scale > ZOOM_EPSILON

  return (
    <div
      ref={hostRef}
      className={cn(
        'bg-muted/30 relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden select-none',
        isZoomed && 'cursor-grab active:cursor-grabbing'
      )}
      onDoubleClick={reset}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}>
      {fit ? (
        <img
          key={props.src}
          src={props.src}
          alt={props.fileName}
          draggable={false}
          className="fade-in animate-in absolute max-w-none duration-200"
          style={{
            width: Math.max(1, fit.width * viewport.scale),
            height: Math.max(1, fit.height * viewport.scale),
            left: STAGE_PAD + viewport.x,
            top: STAGE_PAD + viewport.y
          }}
        />
      ) : (
        // 还没解码出尺寸：先用 contain 顶住，避免拿不到比例时把图拉变形
        <img
          src={props.src}
          alt={props.fileName}
          draggable={false}
          className="fade-in animate-in max-h-full max-w-full object-contain p-2 duration-200"
        />
      )}

      <LightboxZoomBar
        scale={viewport.scale}
        disabled={!natural}
        onZoom={zoomStep}
        onReset={reset}
      />

      {props.showNav && !isZoomed ? (
        <>
          <LightboxNavButton
            label="上一张"
            side="left"
            disabled={!props.canPrev}
            onClick={props.onPrev}
          />
          <LightboxNavButton
            label="下一张"
            side="right"
            disabled={!props.canNext}
            onClick={props.onNext}
          />
        </>
      ) : null}
    </div>
  )
}

function AttachmentLightboxDialog(props: {
  open: boolean
  medias: readonly AttachmentLightboxMedia[]
  initialId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const labels = useAssistantLabels()
  const initialIndex = Math.max(
    0,
    props.medias.findIndex(function (media) {
      return media.id === props.initialId
    })
  )
  /**
   * 打开时从哪张开始，由外层按 `initialId` 换 key 重挂来定（见 `AttachmentLightboxProvider`）。
   * 不在 effect 里 `updateActiveIndex(initialIndex)`：那会多一次渲染，而且「打开」与
   * 「切到某一张」本来就是同一个动作，事后纠正没有意义。
   */
  const [activeIndex, updateActiveIndex] = useState(initialIndex)

  const active = props.medias[activeIndex]
  const canPrev = activeIndex > 0
  const canNext = activeIndex < props.medias.length - 1
  const showNav = props.medias.length > 1
  const { frame, natural } = useAttachmentLightboxFrame(active?.src, props.open)

  useEffect(
    function () {
      if (!props.open || !showNav) return
      function onKeyDown(event: KeyboardEvent) {
        if (event.key === 'ArrowLeft' && canPrev) {
          event.preventDefault()
          updateActiveIndex(function (index) {
            return Math.max(0, index - 1)
          })
        }
        if (event.key === 'ArrowRight' && canNext) {
          event.preventDefault()
          updateActiveIndex(function (index) {
            return Math.min(props.medias.length - 1, index + 1)
          })
        }
      }
      window.addEventListener('keydown', onKeyDown)
      return function () {
        window.removeEventListener('keydown', onKeyDown)
      }
    },
    [props.open, showNav, canPrev, canNext, props.medias.length]
  )

  if (props.medias.length === 0) return null

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton
        overlayClassName="bg-black/80 supports-backdrop-filter:backdrop-blur-sm"
        style={{ width: frame.width, height: frame.height }}
        className={cn(
          'gap-0 overflow-hidden border-border/40 bg-background p-0 shadow-2xl sm:max-w-none',
          // w-auto 盖掉居中 Dialog 默认的 w-full，尺寸交给 style（按图比例）
          'max-h-[88vh] max-w-[92vw] w-auto rounded-2xl',
          '**:data-[slot=dialog-body]:h-full **:data-[slot=dialog-body]:gap-0 **:data-[slot=dialog-body]:overflow-hidden **:data-[slot=dialog-body]:p-0 **:data-[slot=dialog-body]:pb-0',
          // 悬浮圆形关闭：贴卡片右上角，对齐图库观感
          '[&_[data-slot=dialog-close]]:top-3 [&_[data-slot=dialog-close]]:right-3',
          '[&_[data-slot=dialog-close]]:z-20 [&_[data-slot=dialog-close]]:size-8',
          '[&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:opacity-100',
          '[&_[data-slot=dialog-close]]:bg-foreground [&_[data-slot=dialog-close]]:text-background',
          '[&_[data-slot=dialog-close]]:hover:bg-foreground/90 [&_[data-slot=dialog-close]]:hover:text-background',
          '[&_[data-slot=dialog-close]]:ring-0 [&_[data-slot=dialog-close]]:shadow-md'
        )}>
        <DialogTitle className="sr-only">{labels.attachmentPreviewTitle}</DialogTitle>
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-border/50 flex h-11 shrink-0 items-center justify-between gap-3 border-b px-4 pe-12">
            <div className="min-w-0">
              <div
                className="truncate text-sm font-medium"
                title={active?.fileName}>
                {active?.fileName ?? labels.attachmentPreview}
              </div>
              <div className="text-muted-foreground text-xs tabular-nums">
                {showNav ? `${activeIndex + 1} / ${props.medias.length} · ` : ''}
                {labels.zoomHint}
              </div>
            </div>
          </div>

          {active ? (
            <AttachmentZoomStage
              src={active.src}
              fileName={active.fileName}
              natural={natural}
              showNav={showNav}
              canPrev={canPrev}
              canNext={canNext}
              onPrev={function () {
                updateActiveIndex(function (index) {
                  return Math.max(0, index - 1)
                })
              }}
              onNext={function () {
                updateActiveIndex(function (index) {
                  return Math.min(props.medias.length - 1, index + 1)
                })
              }}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AttachmentLightboxProvider(props: {
  medias: readonly AttachmentLightboxMedia[]
  children: ReactNode
}) {
  const [isOpen, updateOpen] = useState(false)
  const [initialId, updateInitialId] = useState<string | null>(null)

  const api = useMemo<AttachmentLightboxApi>(function () {
    return {
      open(id) {
        updateInitialId(id)
        updateOpen(true)
      }
    }
  }, [])

  const onOpenChange = useCallback(function (open: boolean) {
    updateOpen(open)
    if (!open) updateInitialId(null)
  }, [])

  return (
    <AttachmentLightboxContext.Provider value={api}>
      {props.children}
      {/* 每次打开都按 initialId 重挂：从哪张开始由 key 定，组件里不必再同步 */}
      <AttachmentLightboxDialog
        key={isOpen ? `open:${initialId ?? ''}` : 'closed'}
        open={isOpen}
        medias={props.medias}
        initialId={initialId}
        onOpenChange={onOpenChange}
      />
    </AttachmentLightboxContext.Provider>
  )
}

export { AttachmentLightboxProvider, useAttachmentLightbox }
export type { AttachmentLightboxMedia }
