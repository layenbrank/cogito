import { type RefObject, useLayoutEffect, useState } from 'react'

/** 进入：略提前挂载 */
const ROOT_MARGIN = '120px 0px'
/** 离开：更大缓冲，仍在可视区时不卸载 */
const LEAVE_ROOT_MARGIN = '48% 0px'

type UseVisibleOptions = {
  /** 滚动容器；传 null 表示尚未就绪（不观察）；不传则相对视口 */
  root?: Element | null
  rootMargin?: string
  leaveRootMargin?: string
}

function parseMarginY(rootMargin: string) {
  const [raw = '0px'] = rootMargin.trim().split(/\s+/)
  if (raw.endsWith('%')) {
    return { type: 'percent' as const, value: Number.parseFloat(raw) / 100 }
  }
  return { type: 'px' as const, value: Number.parseFloat(raw) || 0 }
}

/** 同步判定是否在滚动容器可见带内（含 margin） */
function isNearRoot(node: HTMLElement, root: Element | null, rootMargin: string) {
  const cardRect = node.getBoundingClientRect()
  const rootRect = root
    ? root.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight, height: window.innerHeight }
  const margin = parseMarginY(rootMargin)
  const pad =
    margin.type === 'percent' ? rootRect.height * margin.value : margin.value

  return cardRect.bottom > rootRect.top - pad && cardRect.top < rootRect.bottom + pad
}

/**
 * 双向可见性（滞回）：
 * - root 就绪时先同步判定，避免首帧 false→true 闪 bone/内容
 * - 进入用较小 margin，离开用较大 margin
 */
function useVisible(ref: RefObject<HTMLElement | null>, options?: UseVisibleOptions) {
  const [isVisible, onUpdateVisible] = useState(false)
  const hasRootOption = options !== undefined && 'root' in options
  const root = hasRootOption ? (options.root ?? null) : null
  const rootMargin = options?.rootMargin ?? ROOT_MARGIN
  const leaveRootMargin = options?.leaveRootMargin ?? LEAVE_ROOT_MARGIN

  useLayoutEffect(
    function () {
      const node = ref.current
      if (!node) return
      if (hasRootOption && root === null) {
        // 首帧同步：root 未就绪时保持不可见，避免错误挂载
        queueMicrotask(function () {
          onUpdateVisible(false)
        })
        return
      }

      let isMounted = isNearRoot(node, root, rootMargin)
      // 首帧同步判定放进 microtask，避免 effect 体内直接 setState
      queueMicrotask(function () {
        onUpdateVisible(isMounted)
      })

      const enterObserver = new IntersectionObserver(
        function (entries) {
          const entry = entries[0]
          if (!entry?.isIntersecting) return
          isMounted = true
          onUpdateVisible(true)
        },
        { root, rootMargin, threshold: 0 }
      )

      const leaveObserver = new IntersectionObserver(
        function (entries) {
          const entry = entries[0]
          if (!entry || entry.isIntersecting || !isMounted) return
          isMounted = false
          onUpdateVisible(false)
        },
        { root, rootMargin: leaveRootMargin, threshold: 0 }
      )

      enterObserver.observe(node)
      leaveObserver.observe(node)

      return function () {
        enterObserver.disconnect()
        leaveObserver.disconnect()
      }
    },
    [ref, hasRootOption, root, rootMargin, leaveRootMargin]
  )

  return isVisible
}

export { useVisible }
export type { UseVisibleOptions }
