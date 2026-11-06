/**
 * 把占位 div 的 rect 持续上报给 Rust，由它 `set_bounds` 到原生子 webview 上；
 * 浮层压过来时走 VS Code 同款「暂停」：先截一帧 → HTML 变暗占位 → 再 hide 原生层。
 *
 * 换层必须重叠，否则会出现空帧闪烁：
 * - 进入：占位先 paint → 再 hide webview
 * - 离开：先 show webview 并等合成 → 再拆占位
 *
 * 遮挡判定（`overlay-cover.ts`）：显式标记 `data-webview="false"` 优先，
 * 未打标记的手写浮层靠 hit-test 兜底 —— 只认标记的话，漏一处就是「浮层被页面盖住」。
 * 与穿透用的 `data-region` 无关，不要混用。
 */
import { useEffect, useRef, useState } from 'react'

import {
  BROWSER_VISIBILITY_RESET,
  screenshotBrowser,
  writeBrowserRect,
  writeBrowserVisible
} from './api'
import { findCoveringOverlay, hasCoverMarker } from './overlay-cover'

/** 截图超时：宁可用缓存帧立刻让位，也不把菜单堵在 webview 下面 */
const PAUSE_SHOT_MS = 120
/** 原生 show 后给合成器一点时间，再撤 HTML 占位 */
const RESUME_SETTLE_MS = 32
/** 缓存帧的保鲜期：VS Code 每 1s 重拍一帧，这里只在「页面重新露出来」时补拍 */
const FRAME_REFRESH_MS = 1000
/** 尺寸变化小于这个值不上报，避免 hover 级重排把 IPC 打满 */
const RECT_EPSILON = 0.5

function sleep(ms: number) {
  return new Promise<void>(function (resolve) {
    window.setTimeout(resolve, ms)
  })
}

/** 等两帧 rAF，确保 React 已把占位画进屏幕 */
function waitPaint() {
  return new Promise<void>(function (resolve) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        resolve()
      })
    })
  })
}

/** 占位图进屏幕并完成解码，再 hide 原生层才不会漏空帧 */
async function settlePauseFrame(src: string | null) {
  await waitPaint()
  if (!src) return
  try {
    const image = new Image()
    image.src = src
    if (typeof image.decode === 'function') {
      await image.decode()
    }
  } catch (error) {
    console.warn('browser: 暂停帧解码失败', error)
  }
}

function useBrowserRect(active: boolean, activeLabel: string | null) {
  const ref = useRef<HTMLDivElement | null>(null)
  const activeLabelRef = useRef(activeLabel)
  activeLabelRef.current = activeLabel

  const [isPaused, updatePaused] = useState(false)
  const [pauseSrc, updatePauseSrc] = useState<string | null>(null)

  const lastFrameRef = useRef<string | null>(null)
  const lastFrameAtRef = useRef(0)
  const lastVisibleRef = useRef<boolean | null>(null)
  const lastRectRef = useRef<{ left: number; top: number; width: number; height: number } | null>(
    null
  )
  /** 已在开发日志里提示过的「没打标记的浮层」，避免每帧刷同一条 */
  const warnedCoverRef = useRef<WeakSet<Element>>(new WeakSet())
  const generationRef = useRef(0)
  const pausingRef = useRef(false)
  const leavingRef = useRef(false)

  useEffect(
    function () {
      const node = ref.current
      if (!active || !node) {
        generationRef.current += 1
        pausingRef.current = false
        leavingRef.current = false
        lastVisibleRef.current = null
        lastRectRef.current = null
        updatePaused(false)
        updatePauseSrc(null)
        void writeBrowserVisible(false).catch(function (error) {
          console.warn('browser: 上报可见性失败', error)
        })
        return
      }

      let frame = 0

      /** 拍一帧当前页面，作为「原生层藏起来」时的占位图 */
      async function captureFrame(label: string): Promise<string | null> {
        try {
          const shot = await screenshotBrowser(label, 'jpeg')
          if (!shot?.base64) return null
          lastFrameAtRef.current = Date.now()
          return `data:${shot.mimeType};base64,${shot.base64}`
        } catch (error) {
          console.warn('browser: 截暂停帧失败', error)
          return null
        }
      }

      /**
       * 页面重新露出来后补拍一帧。
       *
       * 没有这一步，缓存帧永远是「第一次暂停时那一刻」：用户导航到别的页面再
       * 打开菜单，会看到上一页的旧画面（VS Code 用 1s 轮询重拍，见
       * `webContentsViewHost.ts::_captureScreenshot`）。
       */
      function refreshFrame() {
        const label = activeLabelRef.current
        if (!label) return
        if (Date.now() - lastFrameAtRef.current < FRAME_REFRESH_MS) return
        void captureFrame(label).then(function (next) {
          if (next) lastFrameRef.current = next
        })
      }

      async function reportVisible(visible: boolean) {
        if (visible === lastVisibleRef.current) return
        try {
          await writeBrowserVisible(visible)
          // 仅 IPC 成功后才锁住本地态，失败保持可重试（否则会永久白屏）
          lastVisibleRef.current = visible
        } catch (error) {
          lastVisibleRef.current = null
          console.warn('browser: 上报可见性失败', error)
        }
      }

      function reportRect(rect: DOMRect) {
        const next = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        const previous = lastRectRef.current
        if (
          previous &&
          Math.abs(previous.left - next.left) < RECT_EPSILON &&
          Math.abs(previous.top - next.top) < RECT_EPSILON &&
          Math.abs(previous.width - next.width) < RECT_EPSILON &&
          Math.abs(previous.height - next.height) < RECT_EPSILON
        ) {
          return
        }
        lastRectRef.current = next
        void writeBrowserRect(next.left, next.top, next.width, next.height).catch(function (error) {
          console.warn('browser: 上报 rect 失败', error)
        })
      }

      /** hydrate / 重建会把 Rust webview 藏掉，但本地 lastVisible 可能仍是 true → 卡死白屏 */
      function onVisibilityReset() {
        lastVisibleRef.current = false
        pausingRef.current = false
        leavingRef.current = false
        updatePaused(false)
        updatePauseSrc(null)
        schedule()
      }

      async function enterPause() {
        if (pausingRef.current || lastVisibleRef.current === false) return

        const generation = generationRef.current + 1
        generationRef.current = generation
        pausingRef.current = true
        leavingRef.current = false

        let frameSrc = lastFrameRef.current
        if (frameSrc) updatePauseSrc(frameSrc)
        updatePaused(true)

        // 无缓存才短等截图（仍可见时拍）；有缓存直接用，避免 hide 后再拍触发 reveal 闪一下
        if (!frameSrc) {
          const label = activeLabelRef.current
          if (label) {
            const captured = await Promise.race([
              captureFrame(label),
              sleep(PAUSE_SHOT_MS).then(function () {
                return null
              })
            ])
            if (generation !== generationRef.current) {
              pausingRef.current = false
              return
            }
            if (captured) {
              frameSrc = captured
              lastFrameRef.current = captured
              updatePauseSrc(captured)
            }
          }
        }

        if (generation !== generationRef.current) {
          pausingRef.current = false
          return
        }

        await settlePauseFrame(frameSrc)
        if (generation !== generationRef.current) {
          pausingRef.current = false
          return
        }

        await reportVisible(false)
        pausingRef.current = false
      }

      async function leavePause() {
        if (leavingRef.current) return
        // 已经完全可见且不在进入中：无需再 leave
        if (lastVisibleRef.current === true && !pausingRef.current) {
          updatePaused(false)
          updatePauseSrc(null)
          // 兜底：本地以为可见时仍补一次 show，避免与 Rust 脱节后永久白屏
          void writeBrowserVisible(true).catch(function (error) {
            console.warn('browser: 补发可见性失败', error)
          })
          return
        }

        leavingRef.current = true
        const generation = generationRef.current + 1
        generationRef.current = generation
        pausingRef.current = false

        // 占位先留着，等原生层真正露出来再拆，避免中间空帧
        await reportVisible(true)
        if (generation !== generationRef.current) {
          leavingRef.current = false
          // 已露出且没被新的 enter 接手时清掉占位，避免卡在 isPaused
          if (lastVisibleRef.current === true && !pausingRef.current) {
            updatePaused(false)
            updatePauseSrc(null)
          }
          return
        }

        await sleep(RESUME_SETTLE_MS)
        if (generation !== generationRef.current) {
          leavingRef.current = false
          if (lastVisibleRef.current === true && !pausingRef.current) {
            updatePaused(false)
            updatePauseSrc(null)
          }
          return
        }

        updatePaused(false)
        updatePauseSrc(null)
        leavingRef.current = false
        // 页面又露出来了：顺手刷新缓存帧，下次让位不至于显示旧画面
        refreshFrame()
      }

      function tick() {
        frame = 0
        const element = ref.current
        if (!element) return
        const rect = element.getBoundingClientRect()

        reportRect(rect)

        const blocked = findCoveringOverlay(element)
        if (blocked) {
          if (import.meta.env.DEV && !hasCoverMarker(blocked) && !warnedCoverRef.current.has(blocked)) {
            warnedCoverRef.current.add(blocked)
            console.warn(
              '[browser/rect] 浮层没打 data-webview="false"，已按 hit-test 让位（建议补标记）：',
              blocked
            )
          }
          if (lastVisibleRef.current === false && !pausingRef.current) return
          void enterPause()
          return
        }
        if (lastVisibleRef.current !== true || pausingRef.current || leavingRef.current) {
          void leavePause()
        }
      }

      function schedule() {
        if (frame !== 0) return
        frame = requestAnimationFrame(tick)
      }

      const resizeObserver = new ResizeObserver(schedule)
      resizeObserver.observe(node)

      // 只盯让位标记与显隐 / 定位相关属性：`style` / `class` 是浮层「挪位置」的唯一信号
      // （VS Code 的 overlay 观察器同款 filter），tick 里用 rAF 合并、rect 有 epsilon 去重。
      const layerObserver = new MutationObserver(schedule)
      layerObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-webview', 'aria-hidden', 'hidden', 'style', 'class']
      })

      window.addEventListener('resize', schedule)
      window.addEventListener('scroll', schedule, true)
      window.addEventListener(BROWSER_VISIBILITY_RESET, onVisibilityReset)
      schedule()

      return function () {
        resizeObserver.disconnect()
        layerObserver.disconnect()
        window.removeEventListener('resize', schedule)
        window.removeEventListener('scroll', schedule, true)
        window.removeEventListener(BROWSER_VISIBILITY_RESET, onVisibilityReset)
        if (frame !== 0) cancelAnimationFrame(frame)
        generationRef.current += 1
        pausingRef.current = false
        leavingRef.current = false
      }
    },
    [active]
  )

  return { ref, isPaused, pauseSrc }
}

export { useBrowserRect }
