import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { clsx } from 'clsx'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { CHANNELS, EVENTS } from '@/shared/ipc/channels'

import { isMagneticTileComponent } from '@/constants/magnetic-tile/components'
import { useThrough } from '@/hooks/use-through'
import { dispatchKeyCode } from '@/keycodes/dispatcher'
import {
  useOverlayStore,
  type OverlayMode,
  type OverlayTexture,
  type OverlayTile
} from '@/stores/overlay'
import styles from '@/views/overlay/overlay.module.scss'
import Texture from '@/views/overlay/texture'
import Tile from '@/views/overlay/tile'

/** 保持 lazy，避免 create:true 的 overlay 启动时就解析 Konva/Capture */
const Capture = lazy(function () {
  return import('@/features/capture/capture')
})

const OVERLAY_SHELL_SOURCE = 'overlay-shell'

interface MountTilePayload {
  kind: string
  magneticTileID: string
  size?: string | null
  shape?: string | null
  direction?: string | null
  round?: string | null
  background?: MagneticTile.Background | null
  title?: string | null
  mark?: string | null
}

function OverlayShell() {
  const shellRef = useRef<HTMLElement | null>(document.body)
  const stageRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [concealed, setConcealed] = useState(false)
  const [stageBounds, setStageBounds] = useState({
    width: window.innerWidth,
    height: window.innerHeight
  })
  const items = useOverlayStore(function (s) {
    return s.items
  })
  const toMode = useOverlayStore(function (s) {
    return s.toMode
  })
  const toMount = useOverlayStore(function (s) {
    return s.toMount
  })
  const toRemove = useOverlayStore(function (s) {
    return s.toRemove
  })
  const toClear = useOverlayStore(function (s) {
    return s.toClear
  })
  const mode = useOverlayStore(function (s) {
    return s.mode
  })
  const toScreenshotExit = useOverlayStore(function (s) {
    return s.toScreenshotExit
  })
  const toWrite = useOverlayStore(function (s) {
    return s.toWrite
  })

  const isScreenshot = mode === 'screenshot'

  useThrough(OVERLAY_SHELL_SOURCE, { rootRef: shellRef, enabled: !isScreenshot })

  /**
   * ESC：先派发给窗口内注册了 `useKeyCode('escape')` 的组件（截屏浮层逐级退出），
   * 没人接管才兜底退出截屏 —— 浮层没挂上/还没加载完时也能退出来。
   */
  useHotkeys(
    'escape',
    function (event) {
      event.preventDefault()
      void dispatchKeyCode('escape').then(function (handled) {
        if (handled) return
        void toScreenshotExit()
      })
    },
    { enabled: isScreenshot }
  )

  // 追踪 stage 尺寸作为拖拽边界
  useEffect(function () {
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver(function () {
      setStageBounds({ width: stage.clientWidth, height: stage.clientHeight })
    })
    ro.observe(stage)
    return function () {
      ro.disconnect()
    }
  }, [])

  useEffect(
    function () {
      let unlistenMode: (() => void) | undefined
      let unlistenMount: (() => void) | undefined
      let unlistenUnmount: (() => void) | undefined
      let unlistenClear: (() => void) | undefined
      let unlistenHide: (() => void) | undefined
      let unlistenConceal: (() => void) | undefined
      let unlistenReveal: (() => void) | undefined
      let cancelled = false

      function applyMount(payload: MountTilePayload | null | undefined) {
        if (!payload) return
        if (!isMagneticTileComponent(payload.kind) || !payload.magneticTileID) return
        toMount(payload.kind, payload.magneticTileID, {
          size: (payload.size ?? undefined) as Mirror.Size | undefined,
          shape: (payload.shape ?? undefined) as Mirror.Shape | undefined,
          direction: (payload.direction ?? undefined) as Mirror.Direction | undefined,
          round: payload.round ?? null,
          background: payload.background ?? null,
          title: payload.title ?? '',
          mark: payload.mark ?? null
        })
      }

      function applyUnmount(payload: { magneticTileID?: string } | null | undefined) {
        if (!payload?.magneticTileID) return
        toRemove(payload.magneticTileID)
      }

      async function bootstrap() {
        try {
          unlistenMode = await listen<OverlayMode>(EVENTS.OVERLAY_MODE, function (event) {
            toMode(event.payload)
          })
          unlistenMount = await listen<MountTilePayload>(EVENTS.OVERLAY_MOUNT, function (event) {
            applyMount(event.payload)
          })
          unlistenUnmount = await listen<{ magneticTileID: string }>(
            EVENTS.OVERLAY_UNMOUNT,
            function (event) {
              applyUnmount(event.payload)
            }
          )
          unlistenClear = await listen(EVENTS.OVERLAY_CLEAR_TEXTURES, function () {
            toClear()
          })
          unlistenHide = await listen(EVENTS.OVERLAY_HIDE, function () {
            toMode('idle')
            setConcealed(false)
            void invoke(CHANNELS.OVERLAY.HIDE)
          })
          unlistenConceal = await listen(EVENTS.OVERLAY_CONCEAL, function () {
            setConcealed(true)
          })
          unlistenReveal = await listen(EVENTS.OVERLAY_REVEAL, function () {
            setConcealed(false)
          })
          await useOverlayStore.getState().toInitialize()
          applyMount(await invoke<MountTilePayload | null>(CHANNELS.OVERLAY.TAKE_PENDING))
          applyUnmount(
            await invoke<{ magneticTileID: string } | null>(CHANNELS.OVERLAY.TAKE_PENDING_UNMOUNT)
          )
          if (cancelled) return
          setReady(true)
        } catch (err) {
          if (!cancelled) console.warn('[overlay] bootstrap failed', err)
        }
      }

      void bootstrap()

      return function () {
        cancelled = true
        unlistenMode?.()
        unlistenMount?.()
        unlistenUnmount?.()
        unlistenClear?.()
        unlistenHide?.()
        unlistenConceal?.()
        unlistenReveal?.()
      }
    },
    [toClear, toMount, toRemove, toMode]
  )

  const textures = items.filter(function (entry): entry is OverlayTexture {
    return entry.kind === 'texture'
  })
  const tiles = items.filter(function (entry): entry is OverlayTile {
    return entry.kind !== 'texture'
  })

  return (
    <div className={clsx(styles.shell, concealed && styles.concealed)}>
      <div
        ref={stageRef}
        className={styles.stage}>
        {isScreenshot ? (
          <Suspense fallback={null}>
            <Capture
              embedded={true}
              active={true}
              onExit={toScreenshotExit}
              onTexture={function (input) {
                toWrite(input)
              }}
            />
          </Suspense>
        ) : null}
        {ready &&
          !isScreenshot &&
          tiles.map(function (entry) {
            return (
              <Tile
                key={entry.id}
                item={entry}
                stageBounds={stageBounds}
              />
            )
          })}
        {ready &&
          !isScreenshot &&
          textures.map(function (entry) {
            return (
              <Texture
                key={entry.id}
                item={entry}
                stageBounds={stageBounds}
              />
            )
          })}
      </div>
    </div>
  )
}

export default OverlayShell
export { OverlayShell }
