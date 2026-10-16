/**
 * 预览的轮播与缩略图同步：缩放时锁住滑动、打开时定位到初始项、当前项滚进缩略图可视区。
 */
import { useEffect, useState } from 'react'
import { type SwiperClass } from 'swiper/react'

/** 关闭预览时退出全屏：渲染期按 prop 变化调整（React 推荐做法），不用 effect 同步 state */
export function useCloseResetsFullscreen(open: boolean, setIsFullscreen: (value: boolean) => void) {
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setIsFullscreen(false)
  }
}

export function useLightboxSwiper(input: {
  swiper: SwiperClass | null
  isZoomed: boolean
  open: boolean
  initialId: string | null
  initialIndex: number
  onActiveIndexChange: (index: number) => void
}) {
  const { swiper, isZoomed, open, initialId, initialIndex, onActiveIndexChange } = input

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
      if (!open || !swiper) return
      swiper.slideTo(initialIndex, 0)
      onActiveIndexChange(initialIndex)
    },
    // 打开 / 换初始项时才重新定位；分帧灌入过程中无需重复滑
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, initialId, initialIndex, swiper]
  )
}

export function useThumbAutoScroll(input: {
  stripRef: { current: HTMLDivElement | null }
  activeIndex: number
  open: boolean
  isFullscreen: boolean
  isReducedMotion: boolean | null
}) {
  const { stripRef, activeIndex, open, isFullscreen, isReducedMotion } = input

  useEffect(
    function () {
      const strip = stripRef.current
      if (!strip || !open || isFullscreen) return
      const thumb = strip.querySelector<HTMLElement>(`[data-thumb-index="${activeIndex}"]`)
      thumb?.scrollIntoView({
        behavior: isReducedMotion ? 'auto' : 'smooth',
        inline: 'center',
        block: 'nearest'
      })
    },
    [stripRef, activeIndex, open, isFullscreen, isReducedMotion]
  )
}
