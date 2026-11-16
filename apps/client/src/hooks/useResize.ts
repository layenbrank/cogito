import { useEffect, useRef } from 'react'

type ResizeCallback = (rect: DOMRectReadOnly) => void

// 2. 用 WeakMap 存储元素和回调（关键！）
const handlers = new WeakMap<HTMLElement, ResizeCallback>()

let observer: ResizeObserver | null = null

/**
 * 1. 全局单例 ResizeObserver（**懒创建**）。
 *
 * 不能在模块顶层 `new ResizeObserver`：jsdom 里没这个全局，凡 import 到这条链的测试
 * （比如只测路由表的）都会在加载阶段抛 `ReferenceError`，跟 resize 本身毫无关系。
 */
function findObserver(): ResizeObserver | null {
  if (typeof ResizeObserver === 'undefined') return null
  observer ??= new ResizeObserver(function (entries) {
    for (const entry of entries) {
      const target = entry.target as HTMLElement
      const handler = handlers.get(target)
      const DOMRect: DOMRectReadOnly = entry.contentRect
      handler?.(DOMRect)
    }
  })
  return observer
}

function useResize<T extends HTMLElement>(callback: ResizeCallback) {
  const ref = useRef<T>(null)

  useEffect(
    function () {
      const node = ref.current
      const observe = findObserver()
      if (!node || !observe) return

      handlers.set(node, callback)
      observe.observe(node)

      return function () {
        handlers.delete(node)
        observe.unobserve(node)
      }
    },
    [callback]
  )

  return ref
}

export { useResize }
