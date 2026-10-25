/**
 * 预览舞台：轮播承载当前媒体、缩放指示与左右切图按钮。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { A11y, Keyboard, Virtual } from 'swiper/modules'
import { Swiper, type SwiperClass, SwiperSlide } from 'swiper/react'

import 'swiper/css'
import 'swiper/css/virtual'

import { MediaImageStage } from '@/components/media-lightbox/image-stage'
import type { LightboxMedia } from '@/components/media-lightbox/types'

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
      <Icon
        icon={isLeft ? 'lucide:chevron-left' : 'lucide:chevron-right'}
        className="size-5"
      />
    </button>
  )
}

function LightboxStage(props: {
  medias: LightboxMedia[]
  activeIndex: number
  initialIndex: number
  fit: { width: number; height: number }
  isFullscreen: boolean
  isZoomed: boolean
  zoomLabel: number
  isReducedMotion: boolean
  durationSec: number
  stageRef: { current: HTMLDivElement | null }
  mediaRef: { current: HTMLDivElement | null }
  swiper: SwiperClass | null
  onSwiper: (instance: SwiperClass) => void
  onActiveIndexChange: (index: number) => void
  onZoomedChange: (value: boolean) => void
  onScaleChange: (value: number) => void
}) {
  const {
    medias,
    activeIndex,
    initialIndex,
    fit,
    isFullscreen,
    isZoomed,
    zoomLabel,
    isReducedMotion,
    durationSec,
    stageRef,
    mediaRef,
    swiper,
    onSwiper,
    onActiveIndexChange,
    onZoomedChange,
    onScaleChange
  } = props

  return (
    <div
      ref={stageRef}
      className={cn(
        'relative min-h-0 flex-1 overflow-hidden bg-zinc-950',
        isFullscreen && 'pt-0'
      )}>
      <Swiper
        className="relative z-1 size-full"
        modules={[Keyboard, A11y, Virtual]}
        virtual
        keyboard={{ enabled: true }}
        slidesPerView={1}
        spaceBetween={0}
        initialSlide={initialIndex}
        onSwiper={onSwiper}
        onSlideChange={function (instance) {
          onActiveIndexChange(instance.activeIndex)
        }}>
        {medias.map(function (media, index) {
          const isActive = index === activeIndex
          return (
            <SwiperSlide
              key={media.id}
              virtualIndex={index}
              className="relative! size-full">
              {isActive ? (
                media.kind === 'video' ? (
                  <div
                    key={media.id}
                    ref={mediaRef}
                    className="absolute top-0 left-0 overflow-hidden"
                    style={{ width: fit.width, height: fit.height }}>
                    <video
                      className="size-full object-contain"
                      src={media.src}
                      controls
                      autoPlay
                      muted
                      playsInline
                    />
                  </div>
                ) : (
                  <MediaImageStage
                    key={media.id}
                    src={media.src}
                    onZoomedChange={onZoomedChange}
                    onScaleChange={onScaleChange}
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

      {medias.length > 1 && !isZoomed ? (
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
            disabled={activeIndex >= medias.length - 1}
            onClick={function () {
              swiper?.slideNext()
            }}
          />
        </>
      ) : null}
    </div>
  )
}

export { LightboxStage }
