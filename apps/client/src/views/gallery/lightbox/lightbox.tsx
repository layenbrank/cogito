import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogTitle
} from '@i-thinking/design/components/dialog'
import { cn } from 'cn'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { A11y, Keyboard, Virtual } from 'swiper/modules'
import { Swiper, type SwiperClass, SwiperSlide } from 'swiper/react'

import 'swiper/css'
import 'swiper/css/virtual'

import {
  LIGHTBOX_FRAME_ASPECT,
  LIGHTBOX_THUMB_WINDOW,
  MOTION_MS
} from '@/views/gallery/constraints'
import { GalleryImageStage } from '@/views/gallery/lightbox/image-stage'
import { useLightboxZoom } from '@/views/gallery/lightbox/use-lightbox-zoom'
import { formatDuration, type GalleryMedia } from '@/views/gallery/model/media'

interface LightboxProps {
  open: boolean
  medias: GalleryMedia[]
  initialId: string | null
  onOpenChange: (open: boolean) => void
}

interface FrameSize {
  width: number
  height: number
}

interface FitSize {
  width: number
  height: number
}

const HEADER_Y = 48
const THUMB_Y = 64
const FRAME_VW = 0.92
const FRAME_VH = 0.88

function findWindowFrame(isFullscreen: boolean, chromeY: number): FrameSize {
  if (isFullscreen) {
    return {
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight)
    }
  }

  const maxW = window.innerWidth * FRAME_VW
  const maxH = window.innerHeight * FRAME_VH
  let width = maxW
  let height = width / LIGHTBOX_FRAME_ASPECT
  if (height > maxH) {
    height = maxH
    width = height * LIGHTBOX_FRAME_ASPECT
  }

  if (height < chromeY + 160) {
    height = chromeY + 160
    width = height * LIGHTBOX_FRAME_ASPECT
  }

  return {
    width: Math.round(width),
    height: Math.round(height)
  }
}

function findContainFit(
  stageW: number,
  stageH: number,
  mediaAspect: number,
  pad = 16
): FitSize {
  const availW = Math.max(1, stageW - pad * 2)
  const availH = Math.max(1, stageH - pad * 2)
  let width = availW
  let height = width / mediaAspect
  if (height > availH) {
    height = availH
    width = height * mediaAspect
  }
  return {
    width: Math.round(width),
    height: Math.round(height)
  }
}

function LightboxNavButton(props: {
  label: string
  side: 'left' | 'right'
  disabled: boolean
  onClick: () => void
}) {
  const isLeft = props.side === 'left'
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      className={cn(
        'absolute top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full',
        'border border-white/15 bg-black/40 text-white shadow-lg backdrop-blur-md',
        'transition-[background-color,transform,opacity] duration-200',
        'hover:bg-black/60 hover:scale-105 active:scale-95',
        'disabled:pointer-events-none disabled:opacity-25',
        'focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none',
        isLeft ? 'left-3' : 'right-3'
      )}
      onClick={props.onClick}>
      <Icon icon={isLeft ? 'lucide:chevron-left' : 'lucide:chevron-right'} className="size-5" />
    </button>
  )
}

function Lightbox(props: LightboxProps) {
  const [swiper, onSwiper] = useState<SwiperClass | null>(null)
  const [activeIndex, onActiveIndex] = useState(0)
  const [isFullscreen, onFullscreen] = useState(false)
  const [mediaAspect, onMediaAspect] = useState(LIGHTBOX_FRAME_ASPECT)
  const [frame, onFrame] = useState<FrameSize>(function () {
    return findWindowFrame(false, HEADER_Y + THUMB_Y)
  })
  const [fit, onFit] = useState<FitSize>({ width: 320, height: 200 })
  const [canvasZoomed, onCanvasZoomed] = useState(false)
  const [canvasScale, onCanvasScale] = useState(1)
  const stageRef = useRef<HTMLDivElement>(null)
  const mediaRef = useRef<HTMLDivElement>(null)
  const thumbStripRef = useRef<HTMLDivElement>(null)
  const isReducedMotion = useReducedMotion()
  const chromeY = isFullscreen
    ? 0
    : HEADER_Y + (props.medias.length > 1 ? THUMB_Y : 0)

  const initialIndex = Math.max(
    0,
    props.medias.findIndex(function (media) {
      return media.asset.id === props.initialId
    })
  )

  const active = props.medias[activeIndex]
  // 仅跟当前媒体绑定；切图 / 关预览必变 → 缩放回 100%
  const zoomKey = props.open && active ? active.asset.id : null
  const isImage = Boolean(active && active.kind !== 'video')
  const { scale, isZoomed: videoZoomed } = useLightboxZoom({
    stageRef,
    targetRef: mediaRef,
    resetKey: zoomKey,
    enabled: props.open && !isImage,
    fitWidth: fit.width,
    fitHeight: fit.height
  })
  const isZoomed = isImage ? canvasZoomed : videoZoomed
  const zoomLabel = isImage ? canvasScale : scale

  useEffect(
    function () {
      if (!props.open) onFullscreen(false)
    },
    [props.open]
  )

  useEffect(
    function () {
      if (!swiper) return
      swiper.allowTouchMove = !isZoomed
      swiper.allowSlideNext = !isZoomed
      swiper.allowSlidePrev = !isZoomed
    },
    [swiper, isZoomed]
  )

  useEffect(
    function () {
      if (!props.open || !swiper) return
      swiper.slideTo(initialIndex, 0)
      onActiveIndex(initialIndex)
    },
    [props.open, props.initialId, initialIndex, swiper]
  )

  useEffect(
    function () {
      if (!props.open || !active) {
        onMediaAspect(LIGHTBOX_FRAME_ASPECT)
        return
      }

      let cancelled = false

      if (active.kind === 'video') {
        const video = document.createElement('video')
        video.preload = 'metadata'
        video.muted = true
        video.onloadedmetadata = function () {
          if (cancelled) return
          const w = video.videoWidth
          const h = video.videoHeight
          if (w > 0 && h > 0) onMediaAspect(w / h)
        }
        video.onerror = function () {
          if (!cancelled) onMediaAspect(LIGHTBOX_FRAME_ASPECT)
        }
        video.src = active.src
        return function () {
          cancelled = true
          video.removeAttribute('src')
          video.load()
        }
      }

      const img = new Image()
      img.decoding = 'async'
      img.onload = function () {
        if (cancelled) return
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          onMediaAspect(img.naturalWidth / img.naturalHeight)
        }
      }
      img.onerror = function () {
        if (!cancelled) onMediaAspect(LIGHTBOX_FRAME_ASPECT)
      }
      img.src = active.src
      return function () {
        cancelled = true
      }
    },
    [props.open, active?.asset.id, active?.kind, active?.src]
  )

  useLayoutEffect(
    function () {
      if (!props.open) return

      function syncFrame() {
        const next = findWindowFrame(isFullscreen, chromeY)
        onFrame(next)
        const stageH = Math.max(1, next.height - chromeY)
        onFit(findContainFit(next.width, stageH, mediaAspect))
      }

      syncFrame()
      window.addEventListener('resize', syncFrame)
      return function () {
        window.removeEventListener('resize', syncFrame)
      }
    },
    [props.open, isFullscreen, chromeY, mediaAspect]
  )

  const thumbRange = useMemo(
    function () {
      const start = Math.max(0, activeIndex - LIGHTBOX_THUMB_WINDOW)
      const end = Math.min(props.medias.length, activeIndex + LIGHTBOX_THUMB_WINDOW + 1)
      return { start, end }
    },
    [activeIndex, props.medias.length]
  )

  useEffect(
    function () {
      const strip = thumbStripRef.current
      if (!strip || !props.open || isFullscreen) return
      const thumb = strip.querySelector<HTMLElement>(`[data-thumb-index="${activeIndex}"]`)
      thumb?.scrollIntoView({
        behavior: isReducedMotion ? 'auto' : 'smooth',
        inline: 'center',
        block: 'nearest'
      })
    },
    [activeIndex, props.open, isFullscreen, isReducedMotion]
  )

  useEffect(
    function () {
      if (!props.open) return
      function onKey(event: KeyboardEvent) {
        if (event.key === 'f' || event.key === 'F') {
          event.preventDefault()
          onFullscreen(function (value) {
            return !value
          })
        }
        if (event.key === 'Escape' && isFullscreen) {
          event.preventDefault()
          event.stopPropagation()
          onFullscreen(false)
        }
      }
      window.addEventListener('keydown', onKey, true)
      return function () {
        window.removeEventListener('keydown', onKey, true)
      }
    },
    [props.open, isFullscreen]
  )

  const durationSec = MOTION_MS / 1000
  const showThumbs = props.medias.length > 1 && !isFullscreen

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton={!isFullscreen}
        overlayClassName="bg-black/80"
        style={{ width: frame.width, height: frame.height }}
        className={cn(
          'gap-0 overflow-hidden border-border/40 bg-background p-0 sm:max-w-none',
          '[&_[data-slot=dialog-body]]:h-full [&_[data-slot=dialog-body]]:gap-0 [&_[data-slot=dialog-body]]:overflow-hidden [&_[data-slot=dialog-body]]:p-0 [&_[data-slot=dialog-body]]:pb-0',
          isFullscreen
            ? 'fixed inset-0 top-0 left-0 max-h-none max-w-none translate-x-0 translate-y-0 rounded-none border-0'
            : 'max-h-[88vh] max-w-[92vw]'
        )}>
        <DialogTitle className="sr-only">媒体预览</DialogTitle>
        <div className="flex h-full min-h-0 flex-col">
          <div
            className={cn(
              'flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4',
              isFullscreen ? 'absolute inset-x-0 top-0 z-30 border-transparent bg-gradient-to-b from-black/70 to-transparent pr-4 text-white' : 'pr-12'
            )}>
            <div className="min-w-0">
              <div className={cn('truncate text-sm font-medium', isFullscreen && 'text-white')}>
                {active?.asset.fileName ?? '媒体'}
              </div>
              <div className={cn('text-xs', isFullscreen ? 'text-white/70' : 'text-muted-foreground')}>
                {activeIndex + 1} / {props.medias.length}
                {active?.kind === 'video' && active.meta.durationMs
                  ? ` · ${formatDuration(active.meta.durationMs)}`
                  : ''}
                <span className="ml-2 opacity-80">
                  {isImage ? '滚轮缩放' : 'Ctrl+滚轮缩放'}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant={isFullscreen ? 'ghost' : 'ghost'}
                className={isFullscreen ? 'text-white hover:bg-white/15 hover:text-white' : undefined}
                aria-label={isFullscreen ? '退出全屏' : '全屏预览'}
                onClick={function () {
                  onFullscreen(function (value) {
                    return !value
                  })
                }}>
                <Icon icon={isFullscreen ? 'lucide:minimize' : 'lucide:maximize'} />
              </Button>
              {isFullscreen ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-white hover:bg-white/15 hover:text-white"
                  aria-label="关闭"
                  onClick={function () {
                    onFullscreen(false)
                    props.onOpenChange(false)
                  }}>
                  <Icon icon="lucide:x" />
                </Button>
              ) : null}
            </div>
          </div>

          <div
            ref={stageRef}
            className={cn(
              'relative min-h-0 flex-1 overflow-hidden bg-zinc-950',
              isFullscreen && 'pt-0'
            )}>
            <Swiper
              className="relative z-[1] size-full"
              modules={[Keyboard, A11y, Virtual]}
              virtual
              keyboard={{ enabled: true }}
              slidesPerView={1}
              spaceBetween={0}
              initialSlide={initialIndex}
              onSwiper={onSwiper}
              onSlideChange={function (instance) {
                onActiveIndex(instance.activeIndex)
              }}>
              {props.medias.map(function (media, index) {
                const isActive = index === activeIndex
                return (
                  <SwiperSlide
                    key={media.asset.id}
                    virtualIndex={index}
                    className="!relative size-full">
                    {isActive ? (
                      media.kind === 'video' ? (
                        <div
                          key={media.asset.id}
                          ref={mediaRef}
                          className="absolute top-0 left-0 overflow-hidden will-change-[width,height,transform]"
                          style={{ width: fit.width, height: fit.height }}>
                          <video
                            className="size-full object-contain"
                            src={media.src}
                            controls
                            autoPlay
                            playsInline
                          />
                        </div>
                      ) : (
                        <GalleryImageStage
                          key={media.asset.id}
                          src={media.src}
                          onZoomedChange={onCanvasZoomed}
                          onScaleChange={onCanvasScale}
                        />
                      )
                    ) : (
                      <div className="flex size-full items-center justify-center text-muted-foreground/50">
                        <Icon
                          icon={media.kind === 'video' ? 'lucide:play' : 'lucide:image'}
                          className="size-10"
                        />
                      </div>
                    )}
                  </SwiperSlide>
                )
              })}
            </Swiper>

            <AnimatePresence>
              {isZoomed ? (
                <m.div
                  className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs text-white tabular-nums backdrop-blur-md"
                  initial={isReducedMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={isReducedMotion ? undefined : { opacity: 0, y: 4 }}
                  transition={{ duration: durationSec, ease: [0.22, 1, 0.36, 1] }}>
                  {Math.round(zoomLabel * 100)}% · 双击复位
                </m.div>
              ) : null}
            </AnimatePresence>

            {props.medias.length > 1 && !isZoomed ? (
              <>
                <LightboxNavButton
                  label="上一张"
                  side="left"
                  disabled={activeIndex <= 0}
                  onClick={function () {
                    swiper?.slidePrev()
                  }}
                />
                <LightboxNavButton
                  label="下一张"
                  side="right"
                  disabled={activeIndex >= props.medias.length - 1}
                  onClick={function () {
                    swiper?.slideNext()
                  }}
                />
              </>
            ) : null}
          </div>

          {showThumbs ? (
            <div
              ref={thumbStripRef}
              className="flex h-16 shrink-0 gap-1.5 overflow-x-auto border-t border-border/50 bg-background px-3 py-2">
              {thumbRange.start > 0 ? (
                <div className="shrink-0" style={{ width: thumbRange.start * 54 }} aria-hidden />
              ) : null}
              {props.medias.slice(thumbRange.start, thumbRange.end).map(function (media, offset) {
                const index = thumbRange.start + offset
                return (
                  <button
                    key={media.asset.id}
                    type="button"
                    data-thumb-index={index}
                    className={cn(
                      'size-12 shrink-0 overflow-hidden rounded-md border transition-[opacity,border-color,transform] duration-150',
                      index === activeIndex
                        ? 'scale-105 border-primary opacity-100 ring-1 ring-primary/40'
                        : 'border-transparent opacity-65 hover:opacity-100'
                    )}
                    onClick={function () {
                      swiper?.slideTo(index)
                    }}>
                    {media.kind === 'video' ? (
                      <video
                        className="size-full object-cover"
                        src={media.src}
                        muted
                        preload="metadata"
                      />
                    ) : (
                      <img className="size-full object-cover" src={media.src} alt="" loading="lazy" />
                    )}
                  </button>
                )
              })}
              {thumbRange.end < props.medias.length ? (
                <div
                  className="shrink-0"
                  style={{ width: (props.medias.length - thumbRange.end) * 54 }}
                  aria-hidden
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { Lightbox }
export type { LightboxProps }
