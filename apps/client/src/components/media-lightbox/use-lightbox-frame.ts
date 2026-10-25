/**
 * 预览窗框尺寸与快捷键：按窗口算出可用舞台、按媒体宽高比求 contain 尺寸；f / Esc 控制全屏。
 */
import { useEffect, useLayoutEffect, useState } from 'react'

import { LIGHTBOX_FRAME_ASPECT } from '@/components/media-lightbox/constants'
import type { LightboxMedia } from '@/components/media-lightbox/types'

const HEADER_Y = 48
const THUMB_Y = 64
const FRAME_VW = 0.92
const FRAME_VH = 0.88

interface FrameSize {
  width: number
  height: number
}

interface FitSize {
  width: number
  height: number
}

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

function findContainFit(stageW: number, stageH: number, mediaAspect: number, pad = 16): FitSize {
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

export function useLightboxFrame(input: {
  open: boolean
  active: LightboxMedia | undefined
  isFullscreen: boolean
  showThumbStrip: boolean
}) {
  const { open, active, isFullscreen, showThumbStrip } = input
  const [measuredAspect, onMediaAspect] = useState(LIGHTBOX_FRAME_ASPECT)
  const [frame, onFrame] = useState<FrameSize>(function () {
    return findWindowFrame(false, HEADER_Y + THUMB_Y)
  })
  const [fit, onFit] = useState<FitSize>({ width: 320, height: 200 })
  const chromeY = isFullscreen ? 0 : HEADER_Y + (showThumbStrip ? THUMB_Y : 0)
  // 只在「开着且有当前媒体」时用测量宽高比，其余回落默认值（不必在 effect 里重置 state）
  const mediaAspect = open && active ? measuredAspect : LIGHTBOX_FRAME_ASPECT

  useEffect(
    function () {
      if (!open || !active) return

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
    [open, active]
  )

  useLayoutEffect(
    function () {
      if (!open) return

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
    [open, isFullscreen, chromeY, mediaAspect]
  )

  return { frame, fit }
}

export function useLightboxKeys(input: {
  open: boolean
  isFullscreen: boolean
  setIsFullscreen: (value: boolean) => void
}) {
  const { open, isFullscreen, setIsFullscreen } = input

  useEffect(
    function () {
      if (!open) return
      function onKey(event: KeyboardEvent) {
        if (event.key === 'f' || event.key === 'F') {
          event.preventDefault()
          setIsFullscreen(!isFullscreen)
        }
        if (event.key === 'Escape' && isFullscreen) {
          event.preventDefault()
          event.stopPropagation()
          setIsFullscreen(false)
        }
      }
      window.addEventListener('keydown', onKey, true)
      return function () {
        window.removeEventListener('keydown', onKey, true)
      }
    },
    [open, isFullscreen, setIsFullscreen]
  )
}
