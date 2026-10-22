import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { clsx } from 'clsx'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { CHANNELS, EVENTS } from '@/shared/ipc/channels'

import { isMagneticTileComponent } from '@/constants/magnetic-tile/components'
import { useThrough } from '@/hooks/use-through'
import { SHORTCUT_COMMAND } from '@/keyboard/definitions'
import { useCommands } from '@/keyboard/react'
import {
  useOverlayStore,
  type OverlayMode,
  type OverlayTexture,
  type OverlayTile
} from '@/stores/overlay'
import styles from '@/views/overlay/overlay.module.scss'
import { OverlayBoundary } from '@/views/overlay/boundary'
import Texture from '@/views/overlay/texture'
import Tile from '@/views/overlay/tile'

/** 保持 lazy，避免 create:true 的 overlay 启动时就解析 Konva/Capture */
const Capture = lazy(function () {
  return import('@/features/capture/capture')
})

const OVERLAY_SHELL_SOURCE = 'overlay-shell'

/** 心跳间隔：宿主用它判断渲染进程是否还活着（白屏自愈） */
const PING_INTERVAL_MS = 15_000
/** 全局错误在窗口内累计到该数量，就认为页面已不可用 */
const ERROR_RECOVER_THRESHOLD = 3
const ERROR_RECOVER_WINDOW_MS = 10_000
/** 同一次恢复动作的最小间隔，避免连环错误反复隐藏浮层 */
const RECOVER_COOLDOWN_MS = 1000

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

/**
 * 浮层宿主的三个「长跑守卫」：错误风暴兜底、隐藏时清截屏态、心跳。
 *
 * 它们与渲染无关，放在一起也方便看清「什么情况下这一层会被判死」。
 */
function useOverlayHostGuards(recover: () => void): void {
  /**
   * 长跑兜底：未捕获错误 / 未处理拒绝在短时间内反复出现，说明这一层已不可用。
   * 只累计到阈值才恢复（单个瞬时错误不骚扰用户）。
   */
  useEffect(
    function () {
      let errorTimes: number[] = []

      function recordError(source: string, detail: unknown) {
        // 全局 `installExceptionReporting` 已上报 window error / rejection；这里只做风暴恢复
        console.error(`[overlay] ${source}`, detail)
        const now = Date.now()
        errorTimes = errorTimes.filter(function (at) {
          return now - at < ERROR_RECOVER_WINDOW_MS
        })
        errorTimes.push(now)
        if (errorTimes.length >= ERROR_RECOVER_THRESHOLD) {
          errorTimes = []
          recover()
        }
      }

      function onError(event: ErrorEvent) {
        recordError('uncaught error', event.error ?? event.message)
      }
      function onRejection(event: PromiseRejectionEvent) {
        recordError('unhandled rejection', event.reason)
      }

      window.addEventListener('error', onError)
      window.addEventListener('unhandledrejection', onRejection)
      return function () {
        window.removeEventListener('error', onError)
        window.removeEventListener('unhandledrejection', onRejection)
      }
    },
    [recover]
  )

  /** 窗口被隐藏时不保留截屏态：下次显示应该是干净的空层（而非带旧截图的浮层） */
  useEffect(function () {
    function onVisibilityChange() {
      if (document.visibilityState !== 'hidden') return
      if (useOverlayStore.getState().mode !== 'screenshot') return
      void useOverlayStore
        .getState()
        .toScreenshotExit()
        .catch(function (error) {
          console.warn('[overlay] 隐藏时退出截屏失败', error)
        })
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return function () {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  /** 心跳：宿主（overlay:ensure）据此判断渲染进程是否已挂，必要时重载页面 */
  useEffect(function () {
    function ping() {
      void invoke(CHANNELS.OVERLAY.PING).catch(function (error) {
        console.warn('[overlay] 心跳失败', error)
      })
    }

    ping()
    const timer = window.setInterval(ping, PING_INTERVAL_MS)
    return function () {
      window.clearInterval(timer)
    }
  }, [])
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

  const lastRecoverRef = useRef(0)

  /**
   * 出错后的统一恢复：退出截屏态 + 关掉浮层。
   * 浮层是透明置顶层，一旦子树坏掉而窗口还显示着，它就会一直吃点击（用户被卡住）。
   */
  const recover = useCallback(function () {
    const now = Date.now()
    if (now - lastRecoverRef.current < RECOVER_COOLDOWN_MS) return
    lastRecoverRef.current = now
    setConcealed(false)
    void useOverlayStore
      .getState()
      .toScreenshotExit()
      .catch(function (error) {
        console.warn('[overlay] 恢复时退出截屏失败', error)
      })
    void invoke(CHANNELS.OVERLAY.HIDE).catch(function (error) {
      console.warn('[overlay] 恢复时隐藏浮层失败', error)
    })
  }, [])

  /**
   * ESC 兜底：截屏浮层在场时由它接管（逐级回退），没人接管才退出截屏 ——
   * 浮层没挂上 / 还没加载完时也能退出来。
   *
   * 命令只在截屏态注册，所以其它模式下这个键位不会被派发器认领。
   */
  useCommands(
    isScreenshot
      ? [
          {
            id: SHORTCUT_COMMAND.OVERLAY_ESCAPE,
            title: '截屏：退出',
            group: '截屏',
            run: toScreenshotExit
          }
        ]
      : []
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

  useOverlayHostGuards(recover)

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
      const pendingUnlistens: Array<Promise<UnlistenFn>> = []

      /** 注册监听并登记：effect 在 await 期间被卸载时，晚到的 unlisten 也要执行（否则永久泄漏） */
      function track(promise: Promise<UnlistenFn>): Promise<UnlistenFn> {
        pendingUnlistens.push(promise)
        return promise.then(function (unlisten) {
          if (cancelled) unlisten()
          return unlisten
        })
      }

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
          unlistenMode = await track(
            listen<OverlayMode>(EVENTS.OVERLAY_MODE, function (event) {
              toMode(event.payload)
            })
          )
          unlistenMount = await track(
            listen<MountTilePayload>(EVENTS.OVERLAY_MOUNT, function (event) {
              applyMount(event.payload)
            })
          )
          unlistenUnmount = await track(
            listen<{ magneticTileID: string }>(EVENTS.OVERLAY_UNMOUNT, function (event) {
              applyUnmount(event.payload)
            })
          )
          unlistenClear = await track(
            listen(EVENTS.OVERLAY_CLEAR_TEXTURES, function () {
              toClear()
            })
          )
          unlistenHide = await track(
            listen(EVENTS.OVERLAY_HIDE, function () {
              toMode('idle')
              setConcealed(false)
              void invoke(CHANNELS.OVERLAY.HIDE)
            })
          )
          unlistenConceal = await track(
            listen(EVENTS.OVERLAY_CONCEAL, function () {
              setConcealed(true)
              // 截屏只 hide DOM；若窗壳仍挂着 mica，毛玻璃会进位图。再清一次作兜底。
              void getCurrentWindow()
                .clearEffects()
                .catch(function (error: unknown) {
                  console.warn('[overlay] conceal 时 clearEffects 失败', error)
                })
            })
          )
          unlistenReveal = await track(
            listen(EVENTS.OVERLAY_REVEAL, function () {
              setConcealed(false)
            })
          )
          await useOverlayStore.getState().toInitialize()
          // 页面可能是被宿主重载的：只靠事件会丢模式，这里主动同步一次
          toMode(await invoke<OverlayMode>(CHANNELS.OVERLAY.READ_MODE))
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

  /** 外部状态指纹：变化后允许兜底边界重试渲染 */
  const boundaryKey = `${mode}:${items.length}:${concealed}`

  return (
    <OverlayBoundary
      resetKey={boundaryKey}
      onRecover={recover}>
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
    </OverlayBoundary>
  )
}

export default OverlayShell
export { OverlayShell }
