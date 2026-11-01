/**
 * 把占位 div 的 rect 持续上报给 Rust，由它 `set_bounds` 到原生子 webview 上；
 * 浮层压过来时走 VS Code 同款「暂停」：先截一帧 → HTML 变暗占位 → 再 hide 原生层。
 *
 * 换层必须重叠，否则会出现空帧闪烁：
 * - 进入：占位先 paint → 再 hide webview
 * - 离开：先 show webview 并等合成 → 再拆占位
 *
 * 遮挡判定只认 `data-webview="false"`（见 `@cogito/design/lib/webview-cover`），
 * 与穿透的 `data-region` 分开；不再用 `data-side` / `role` 启发式。
 */
import { WEBVIEW_COVER_SELECTOR } from '@cogito/design/lib/webview-cover'
import { useEffect, useRef, useState } from 'react'

import { screenshotBrowser, writeBrowserRect, writeBrowserVisible } from './api'

/** 截图超时：宁可用缓存帧立刻让位，也不把菜单堵在 webview 下面 */
const PAUSE_SHOT_MS = 120
/** 原生 show 后给合成器一点时间，再撤 HTML 占位 */
const RESUME_SETTLE_MS = 32

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** 是否有实体浮层（data-webview=false）压在 `surface` 上 */
function findBlocker(surface: DOMRect): boolean {
  if (surface.width < 1 || surface.height < 1) return false
  const layers = document.querySelectorAll<HTMLElement>(WEBVIEW_COVER_SELECTOR)
  for (const layer of layers) {
    if (layer.hidden || layer.getAttribute('aria-hidden') === 'true') continue
    const style = getComputedStyle(layer)
    // 关闭动画期间元素还在但已经点了穿透：按“不遮挡”算更接近视觉
    if (style.pointerEvents === 'none') continue
    if (style.visibility === 'hidden' || style.display === 'none') continue
    const rect = layer.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue
    if (intersects(rect, surface)) return true
  }
  return false
}

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
  const lastVisibleRef = useRef<boolean | null>(null)
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
        updatePaused(false)
        updatePauseSrc(null)
        void writeBrowserVisible(false).catch(function (error) {
          console.warn('browser: 上报可见性失败', error)
        })
        return
      }

      let frame = 0

      async function reportVisible(visible: boolean) {
        if (visible === lastVisibleRef.current) return
        lastVisibleRef.current = visible
        try {
          await writeBrowserVisible(visible)
        } catch (error) {
          console.warn('browser: 上报可见性失败', error)
        }
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
            try {
              const shot = await Promise.race([
                screenshotBrowser(label, 'jpeg'),
                sleep(PAUSE_SHOT_MS).then(function () {
                  return null
                })
              ])
              if (generation !== generationRef.current) {
                pausingRef.current = false
                return
              }
              if (shot?.base64) {
                frameSrc = `data:${shot.mimeType};base64,${shot.base64}`
                lastFrameRef.current = frameSrc
                updatePauseSrc(frameSrc)
              }
            } catch (error) {
              console.warn('browser: 暂停截图失败', error)
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
      }

      function tick() {
        frame = 0
        const element = ref.current
        if (!element) return
        const rect = element.getBoundingClientRect()

        void writeBrowserRect(rect.left, rect.top, rect.width, rect.height).catch(
          function (error) {
            console.warn('browser: 上报 rect 失败', error)
          }
        )

        const blocked = findBlocker(rect)
        if (blocked) {
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

      // 只盯让位标记与显隐相关属性；style/class 会因 hover/动画狂刷
      const layerObserver = new MutationObserver(schedule)
      layerObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-webview', 'aria-hidden', 'hidden']
      })

      window.addEventListener('resize', schedule)
      window.addEventListener('scroll', schedule, true)
      schedule()

      return function () {
        resizeObserver.disconnect()
        layerObserver.disconnect()
        window.removeEventListener('resize', schedule)
        window.removeEventListener('scroll', schedule, true)
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
