/**
 * 把占位 div 的 rect 持续上报给 Rust，由它 `set_bounds` 到原生子 webview 上；
 * 同时在**有浮层压过来时让它让位**。
 *
 * 为什么必须让位：原生子 webview 永远盖在 HTML 之上，没有任何办法把 HTML 画到它
 * 上面。model picker / 下拉菜单 / 对话框一旦与这块矩形相交，就必须
 * `browser_visible(false)`，浮层关掉再恢复。VS Code 的 `BrowserView` 同策略。
 *
 * 为什么用 ResizeObserver + rAF 而不是 layout effect：右栏宽度由 splitter 拖动、
 * 窗口可缩放、页签切换都会改变这块区域，任何一处漏掉 webview 就会错位。
 * 合并到一帧只上报一次，拖拽时也不会把 IPC 打爆。
 */
import { useEffect, useRef } from 'react'

import { writeBrowserRect, writeBrowserVisible } from './api'

/**
 * 浮层判定选择器。
 *
 * base-ui 的 Positioner / Popup 一定带 `data-side`（`OVERLAY_SHELL` 里那些
 * `data-[side=bottom]:…` 变体就是靠它），对话框走 `role="dialog"`。
 * 刻意不按「`position: fixed`」泛匹配：sonner toast 也是 fixed，但它落在左下角、
 * 与右栏不相交，扫进来只会白跑。
 */
const LAYER_SELECTOR = '[data-side], [role="dialog"], [role="alertdialog"]'

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** 是否有可见浮层压在 `surface` 上 */
function findBlocker(surface: DOMRect): boolean {
  if (surface.width < 1 || surface.height < 1) return false
  const layers = document.querySelectorAll<HTMLElement>(LAYER_SELECTOR)
  for (const layer of layers) {
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

function useBrowserRect(active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(
    function () {
      const node = ref.current
      if (!node) return
      let frame = 0
      let lastVisible: boolean | null = null

      function reportVisible(visible: boolean) {
        // 只在翻转时发：拖动 splitter 每帧都调一遍 IPC 没意义
        if (visible === lastVisible) return
        lastVisible = visible
        void writeBrowserVisible(visible).catch(function (error) {
          console.warn('browser: 上报可见性失败', error)
        })
      }

      function tick() {
        frame = 0
        const element = ref.current
        if (!element) return
        const rect = element.getBoundingClientRect()

        void writeBrowserRect(rect.left, rect.top, rect.width, rect.height).catch(
          function (error) {
            // 上报失败 = 原生 webview 永远不会 show，必须喊出来，否则就是"点了没反应"
            console.warn('browser: 上报 rect 失败', error)
          }
        )
        reportVisible(!findBlocker(rect))
      }

      function schedule() {
        if (frame !== 0) return
        frame = requestAnimationFrame(tick)
      }

      const resizeObserver = new ResizeObserver(schedule)
      resizeObserver.observe(node)

      // 浮层开合会动 `data-side` / `data-open` / 节点增删。
      // 不监听 class/style —— 复杂页面上那会把回调刷爆
      const layerObserver = new MutationObserver(schedule)
      layerObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-side', 'data-open', 'data-closed', 'aria-hidden']
      })

      window.addEventListener('resize', schedule)
      // 右栏拖动只改宽度，位置变化靠这条兜住（滚动容器 / 页签切换）
      window.addEventListener('scroll', schedule, true)
      schedule()

      return function () {
        resizeObserver.disconnect()
        layerObserver.disconnect()
        window.removeEventListener('resize', schedule)
        window.removeEventListener('scroll', schedule, true)
        if (frame !== 0) cancelAnimationFrame(frame)
      }
    },
    [active]
  )

  return ref
}

export { useBrowserRect }
