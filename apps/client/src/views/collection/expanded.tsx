import { getCurrentWindow } from '@tauri-apps/api/window'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useCollectionStore, type OriginRect } from '@/stores/collection'
import { CollectionPanel } from '@/views/collection/panel.tsx'

const PANEL_WIDTH = 720
const PANEL_HEIGHT = 520
const MOTION_MS = 0.32

interface FlipStart {
  x: number
  y: number
  scale: number
}

function findTargetBox() {
  const width = Math.min(PANEL_WIDTH, window.innerWidth * 0.9)
  const height = Math.min(PANEL_HEIGHT, window.innerHeight * 0.8)
  return {
    width,
    height,
    x: (window.innerWidth - width) / 2,
    y: (window.innerHeight - height) / 2
  }
}

function findFlipStart(origin: OriginRect): FlipStart {
  const target = findTargetBox()
  const originCx = origin.x + origin.width / 2
  const originCy = origin.y + origin.height / 2
  const targetCx = target.x + target.width / 2
  const targetCy = target.y + target.height / 2
  const scale = Math.max(
    Math.min(origin.width / target.width, origin.height / target.height),
    0.08
  )
  return {
    x: originCx - targetCx,
    y: originCy - targetCy,
    scale
  }
}

function CollectionExpanded() {
  const openId = useCollectionStore(function (state) {
    return state.openId
  })
  const originRect = useCollectionStore(function (state) {
    return state.originRect
  })
  const toClose = useCollectionStore(function (state) {
    return state.toClose
  })

  const isReducedMotion = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const [isVisible, onUpdateVisible] = useState(false)
  const [sessionId, onUpdateSessionId] = useState<string | null>(null)
  const [sessionRect, onUpdateSessionRect] = useState<OriginRect | null>(null)

  // 打开时锁住 session，关闭动画播完再清 store
  useEffect(
    function () {
      if (openId && originRect) {
        onUpdateSessionId(openId)
        onUpdateSessionRect(originRect)
        onUpdateVisible(true)
        return
      }
      if (!openId) {
        onUpdateVisible(false)
      }
    },
    [openId, originRect]
  )

  const flipStart = useMemo(
    function () {
      if (!sessionRect) return null
      return findFlipStart(sessionRect)
    },
    [sessionRect]
  )

  const targetBox = useMemo(function () {
    return findTargetBox()
  }, [sessionId])

  useLayoutEffect(
    function () {
      if (!isVisible || !panelRef.current) return
      panelRef.current.focus()
    },
    [isVisible]
  )

  useEffect(
    function () {
      if (!isVisible) return

      function onKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
          event.preventDefault()
          toClose()
        }
      }

      window.addEventListener('keydown', onKeyDown)
      return function () {
        window.removeEventListener('keydown', onKeyDown)
      }
    },
    [isVisible, toClose]
  )

  // 主窗失焦 → 还原
  useEffect(
    function () {
      if (!isVisible) return

      let unlisten: (() => void) | undefined
      let cancelled = false

      async function bindFocus() {
        try {
          unlisten = await getCurrentWindow().onFocusChanged(function (event) {
            if (!event.payload) toClose()
          })
          if (cancelled) unlisten()
        } catch (error) {
          console.warn('[collection] onFocusChanged unavailable, fallback to blur', error)
          function onBlur() {
            toClose()
          }
          window.addEventListener('blur', onBlur)
          unlisten = function () {
            window.removeEventListener('blur', onBlur)
          }
        }
      }

      void bindFocus()
      return function () {
        cancelled = true
        unlisten?.()
      }
    },
    [isVisible, toClose]
  )

  function onExitComplete() {
    onUpdateSessionId(null)
    onUpdateSessionRect(null)
  }

  if (typeof document === 'undefined') return null

  const show = isVisible && !!sessionId && !!flipStart

  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {show ? (
        <m.div
          key={sessionId}
          className="fixed inset-0 z-50"
          role="presentation">
          <m.button
            type="button"
            aria-label="关闭集合"
            className="absolute inset-0 cursor-default border-0 bg-black/20 supports-backdrop-filter:backdrop-blur-xs"
            initial={{ opacity: isReducedMotion ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: isReducedMotion ? 1 : 0 }}
            transition={{ duration: isReducedMotion ? 0 : MOTION_MS * 0.7 }}
            onClick={function () {
              toClose()
            }}
          />
          <m.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="集合"
            tabIndex={-1}
            className="absolute overflow-hidden rounded-xl border border-border/80 bg-background shadow-lg outline-none"
            style={{
              width: targetBox.width,
              height: targetBox.height,
              left: targetBox.x,
              top: targetBox.y,
              transformOrigin: 'center center'
            }}
            initial={
              isReducedMotion
                ? false
                : {
                    x: flipStart.x,
                    y: flipStart.y,
                    scale: flipStart.scale,
                    opacity: 0.85
                  }
            }
            animate={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            exit={
              isReducedMotion
                ? { opacity: 0 }
                : {
                    x: flipStart.x,
                    y: flipStart.y,
                    scale: flipStart.scale,
                    opacity: 0.85
                  }
            }
            transition={{
              duration: isReducedMotion ? 0 : MOTION_MS,
              ease: [0.22, 1, 0.36, 1]
            }}
            onClick={function (event) {
              event.stopPropagation()
            }}>
            <CollectionPanel id={sessionId} />
          </m.div>
        </m.div>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}

export { CollectionExpanded }
