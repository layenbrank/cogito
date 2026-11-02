/**
 * Composer / 用户消息图片预览：对齐图库 MediaLightbox 的观感
 * （深色遮罩、圆角卡片、悬浮圆形关闭、左右切图）。
 *
 * 弹层尺寸按图片天然宽高比 contain，避免继承 Dialog `w-full` 后
 * 竖图（如侧栏浏览器截图）两侧留出大片空白、看起来比例错了。
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
  useState,
  type ReactNode
} from 'react'

import { Button } from '../components/button'
import { Dialog, DialogContent, DialogTitle } from '../components/dialog'
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

/** 读 naturalWidth/Height，把弹层收成图片 contain 后的外框 */
function useAttachmentLightboxFrame(src: string | undefined, open: boolean): FrameSize {
  const [aspect, updateAspect] = useState(FALLBACK_ASPECT)
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
          updateAspect(image.naturalWidth / image.naturalHeight)
        }
      }
      image.onerror = function () {
        if (!cancelled) updateAspect(FALLBACK_ASPECT)
      }
      image.src = src
      return function () {
        cancelled = true
      }
    },
    [open, src]
  )

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

  return frame
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
  const frame = useAttachmentLightboxFrame(active?.src, props.open)

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
              {showNav ? (
                <div className="text-muted-foreground text-xs tabular-nums">
                  {activeIndex + 1} / {props.medias.length}
                </div>
              ) : null}
            </div>
          </div>

          <div className="bg-muted/30 relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
            {active ? (
              <img
                key={active.id}
                src={active.src}
                alt={active.fileName}
                className="fade-in zoom-in-95 animate-in max-h-full max-w-full object-contain duration-200"
                draggable={false}
              />
            ) : null}

            {showNav ? (
              <>
                <LightboxNavButton
                  label="上一张"
                  side="left"
                  disabled={!canPrev}
                  onClick={function () {
                    updateActiveIndex(function (index) {
                      return Math.max(0, index - 1)
                    })
                  }}
                />
                <LightboxNavButton
                  label="下一张"
                  side="right"
                  disabled={!canNext}
                  onClick={function () {
                    updateActiveIndex(function (index) {
                      return Math.min(props.medias.length - 1, index + 1)
                    })
                  }}
                />
              </>
            ) : null}
          </div>
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
