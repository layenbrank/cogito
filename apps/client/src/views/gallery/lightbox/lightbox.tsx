import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Dialog, DialogContent, DialogTitle } from '@i-thinking/design/components/dialog'
import { cn } from 'cn'
import { useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type SwiperClass } from 'swiper/react'

import { LIGHTBOX_THUMB_WINDOW, MOTION_MS } from '@/views/gallery/constraints'
import { LightboxStage } from '@/views/gallery/lightbox/lightbox-stage'
import { useLightboxFrame, useLightboxKeys } from '@/views/gallery/lightbox/use-lightbox-frame'
import {
  useCloseResetsFullscreen,
  useLightboxSwiper,
  useThumbAutoScroll
} from '@/views/gallery/lightbox/use-lightbox-sync'
import { useLightboxZoom } from '@/views/gallery/lightbox/use-lightbox-zoom'
import { formatDuration, type GalleryMedia } from '@/views/gallery/model/media'

interface LightboxProps {
  open: boolean
  medias: GalleryMedia[]
  initialId: string | null
  onOpenChange: (open: boolean) => void
}

/** 序号 + 视频时长 */
function findMetaLabel(active: GalleryMedia | undefined, activeIndex: number, total: number) {
  const position = `${activeIndex + 1} / ${total}`
  if (!active || active.kind !== 'video' || !active.meta.durationMs) return position
  return `${position} · ${formatDuration(active.meta.durationMs)}`
}

function showThumbStrip(mediaCount: number, isFullscreen: boolean) {
  return mediaCount > 1 && !isFullscreen
}

/** 顶部标题条：文件名、序号与全屏/关闭按钮 */
function LightboxHeader(props: {
  fileName: string
  metaLabel: string
  hintLabel: string
  isFullscreen: boolean
  onToggleFullscreen: () => void
  onClose: () => void
}) {
  return (
    <div
      className={cn(
        'flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4',
        props.isFullscreen
          ? 'absolute inset-x-0 top-0 z-30 border-transparent bg-gradient-to-b from-black/70 to-transparent pr-4 text-white'
          : 'pr-12'
      )}>
      <div className="min-w-0">
        <div className={cn('truncate text-sm font-medium', props.isFullscreen && 'text-white')}>
          {props.fileName}
        </div>
        <div
          className={cn('text-xs', props.isFullscreen ? 'text-white/70' : 'text-muted-foreground')}>
          {props.metaLabel}
          <span className="ml-2 opacity-80">{props.hintLabel}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className={
            props.isFullscreen ? 'text-white hover:bg-white/15 hover:text-white' : undefined
          }
          aria-label={props.isFullscreen ? '退出全屏' : '全屏预览'}
          onClick={props.onToggleFullscreen}>
          <Icon icon={props.isFullscreen ? 'lucide:minimize' : 'lucide:maximize'} />
        </Button>
        {props.isFullscreen ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-white hover:bg-white/15 hover:text-white"
            aria-label="关闭"
            onClick={props.onClose}>
            <Icon icon="lucide:x" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** 底部缩略图条：只渲染可视范围内的项，两侧用占位块撑开滚动条 */
function LightboxThumbStrip(props: {
  medias: GalleryMedia[]
  activeIndex: number
  range: { start: number; end: number }
  stripRef: { current: HTMLDivElement | null }
  onSelect: (index: number) => void
}) {
  return (
    <div
      ref={props.stripRef}
      className="flex h-16 shrink-0 gap-1.5 overflow-x-auto border-t border-border/50 bg-background px-3 py-2">
      {props.range.start > 0 ? (
        <div
          className="shrink-0"
          style={{ width: props.range.start * 54 }}
          aria-hidden
        />
      ) : null}
      {props.medias.slice(props.range.start, props.range.end).map(function (media, offset) {
        const index = props.range.start + offset
        return (
          <button
            key={media.asset.id}
            type="button"
            data-thumb-index={index}
            aria-label={`切换到第 ${index + 1} 项`}
            className={cn(
              'size-12 shrink-0 overflow-hidden rounded-md border transition-[opacity,border-color,transform] duration-150',
              index === props.activeIndex
                ? 'scale-105 border-primary opacity-100 ring-1 ring-primary/40'
                : 'border-transparent opacity-65 hover:opacity-100'
            )}
            onClick={function () {
              props.onSelect(index)
            }}>
            {media.kind === 'video' ? (
              <video
                className="size-full object-cover"
                src={media.src}
                muted
                preload="metadata"
              />
            ) : (
              <img
                className="size-full object-cover"
                src={media.src}
                alt=""
                loading="lazy"
              />
            )}
          </button>
        )
      })}
      {props.range.end < props.medias.length ? (
        <div
          className="shrink-0"
          style={{ width: (props.medias.length - props.range.end) * 54 }}
          aria-hidden
        />
      ) : null}
    </div>
  )
}

function Lightbox(props: LightboxProps) {
  const [swiper, onSwiper] = useState<SwiperClass | null>(null)
  const [activeIndex, onActiveIndex] = useState(0)
  const [isFullscreen, onFullscreen] = useState(false)
  useCloseResetsFullscreen(props.open, onFullscreen)
  const [canvasZoomed, onCanvasZoomed] = useState(false)
  const [canvasScale, onCanvasScale] = useState(1)
  const stageRef = useRef<HTMLDivElement>(null)
  const mediaRef = useRef<HTMLDivElement>(null)
  const thumbStripRef = useRef<HTMLDivElement>(null)
  const isReducedMotion = useReducedMotion()

  const initialIndex = Math.max(
    0,
    props.medias.findIndex(function (media) {
      return media.asset.id === props.initialId
    })
  )

  const active = props.medias[activeIndex]
  const { frame, fit } = useLightboxFrame({
    open: props.open,
    active,
    isFullscreen,
    showThumbStrip: props.medias.length > 1
  })
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

  useLightboxSwiper({
    swiper,
    isZoomed,
    open: props.open,
    initialId: props.initialId,
    initialIndex,
    onActiveIndexChange: onActiveIndex
  })

  const thumbRange = useMemo(
    function () {
      const start = Math.max(0, activeIndex - LIGHTBOX_THUMB_WINDOW)
      const end = Math.min(props.medias.length, activeIndex + LIGHTBOX_THUMB_WINDOW + 1)
      return { start, end }
    },
    [activeIndex, props.medias.length]
  )

  useThumbAutoScroll({
    stripRef: thumbStripRef,
    activeIndex,
    open: props.open,
    isFullscreen,
    isReducedMotion
  })

  useLightboxKeys({
    open: props.open,
    isFullscreen,
    setIsFullscreen: onFullscreen
  })

  const durationSec = MOTION_MS / 1000
  const showThumbs = showThumbStrip(props.medias.length, isFullscreen)
  const metaLabel = findMetaLabel(active, activeIndex, props.medias.length)

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
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
          <LightboxHeader
            fileName={active?.asset.fileName ?? '媒体'}
            metaLabel={metaLabel}
            hintLabel={isImage ? '滚轮缩放' : 'Ctrl+滚轮缩放'}
            isFullscreen={isFullscreen}
            onToggleFullscreen={function () {
              onFullscreen(function (value) {
                return !value
              })
            }}
            onClose={function () {
              onFullscreen(false)
              props.onOpenChange(false)
            }}
          />

          <LightboxStage
            medias={props.medias}
            activeIndex={activeIndex}
            initialIndex={initialIndex}
            fit={fit}
            isFullscreen={isFullscreen}
            isZoomed={isZoomed}
            zoomLabel={zoomLabel}
            isReducedMotion={Boolean(isReducedMotion)}
            durationSec={durationSec}
            stageRef={stageRef}
            mediaRef={mediaRef}
            swiper={swiper}
            onSwiper={onSwiper}
            onActiveIndexChange={onActiveIndex}
            onZoomedChange={onCanvasZoomed}
            onScaleChange={onCanvasScale}
          />

          {showThumbs ? (
            <LightboxThumbStrip
              medias={props.medias}
              activeIndex={activeIndex}
              range={thumbRange}
              stripRef={thumbStripRef}
              onSelect={function (index) {
                swiper?.slideTo(index)
              }}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { Lightbox }
export type { LightboxProps }
