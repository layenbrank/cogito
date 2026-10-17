import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SwiperClass } from 'swiper/react'

import { useLightboxSwiper } from './use-lightbox-sync.ts'

type FakeSwiper = {
  destroyed: boolean
  params: { allowTouchMove: boolean }
  allowTouchMove: boolean
  allowSlideNext: boolean
  allowSlidePrev: boolean
  slideTo: (index: number, speed?: number) => void
}

function createFakeSwiper(overrides: Partial<FakeSwiper> = {}): FakeSwiper {
  return {
    destroyed: false,
    params: { allowTouchMove: true },
    allowTouchMove: true,
    allowSlideNext: true,
    allowSlidePrev: true,
    slideTo: vi.fn(),
    ...overrides
  }
}

function renderLightboxSwiper(swiper: FakeSwiper, initialIsZoomed: boolean) {
  return renderHook(
    function (props: { isZoomed: boolean }) {
      useLightboxSwiper({
        swiper: swiper as unknown as SwiperClass,
        isZoomed: props.isZoomed,
        open: true,
        initialId: 'a',
        initialIndex: 0,
        onActiveIndexChange: function () {}
      })
    },
    { initialProps: { isZoomed: initialIsZoomed } }
  )
}

describe('useLightboxSwiper', function () {
  it('缩放时锁住触摸与翻页，退出缩放后恢复', function () {
    const swiper = createFakeSwiper()
    const { rerender } = renderLightboxSwiper(swiper, true)

    expect(swiper.allowTouchMove).toBe(false)
    expect(swiper.params.allowTouchMove).toBe(false)
    expect(swiper.allowSlideNext).toBe(false)
    expect(swiper.allowSlidePrev).toBe(false)

    rerender({ isZoomed: false })

    expect(swiper.allowTouchMove).toBe(true)
    expect(swiper.params.allowTouchMove).toBe(true)
    expect(swiper.allowSlideNext).toBe(true)
    expect(swiper.allowSlidePrev).toBe(true)
  })

  it('实例已销毁（关闭预览后）不再触碰它，也不抛错', function () {
    // 关闭预览时 <Swiper> 卸载并按 deleteInstance 销毁，params 已被清空，
    // 此时任何 enable()/属性写入都会炸 —— 回归用例
    const swiper = createFakeSwiper({ destroyed: true })

    expect(function () {
      renderLightboxSwiper(swiper, false)
    }).not.toThrow()
    expect(swiper.allowTouchMove).toBe(true)
    expect(swiper.params.allowTouchMove).toBe(true)
  })
})
