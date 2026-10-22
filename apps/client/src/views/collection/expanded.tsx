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

/** 一次展开锁定的快照：id + 起始矩形 + 目标框 */
interface SessionSnapshot {
  id: string
  rect: OriginRect
  box: ReturnType<typeof findTargetBox>
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

/** 打开时锁住 session（id / 起始矩形 / 目标框）；关闭动画播完由调用方清空 */
function useSessionSnapshot(openId: string | null, originRect: OriginRect | null) {
  const [session, onUpdateSession] = useState<SessionSnapshot | null>(null)
  // 渲染期按 prop 变化调整，不用 effect（新 id 到位才重建快照）
  if (openId && originRect && session?.id !== openId) {
    onUpdateSession({ id: openId, rect: originRect, box: findTargetBox() })
  }
  return { session, onUpdateSession }
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
  const { session, onUpdateSession } = useSessionSnapshot(openId, originRect)

  const isVisible = openId !== null
  const flipStart = useMemo(function () {
    if (!session) return null
    return findFlipStart(session.rect)
  }, [session])

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
    onUpdateSession(null)
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {isVisible && session && flipStart ? (
        <m.div
          key={session.id}
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
              width: session.box.width,
              height: session.box.height,
              left: session.box.x,
              top: session.box.y,
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
            <CollectionPanel
              key={session.id}
              id={session.id}
            />
          </m.div>
        </m.div>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}

export { CollectionExpanded }
