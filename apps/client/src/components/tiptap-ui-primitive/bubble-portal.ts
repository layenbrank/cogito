/**
 * BubbleMenu 内浮层须挂在菜单 DOM 树内，否则 TipTap shouldShow 会关掉气泡。
 * 优先从触发点 closest；禁止 document 全局 querySelector 取「第一个」以免挂错实例。
 */
function findBubbleMenuContainer(from?: ParentNode | null): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const starts: Element[] = []
  if (from instanceof Element) {
    starts.push(from)
  }
  if (document.activeElement instanceof Element) {
    starts.push(document.activeElement)
  }
  for (const start of starts) {
    const hit = start.closest('[data-slot="tiptap-bubble-menu"]')
    if (hit instanceof HTMLElement) return hit
  }
  return null
}

export { findBubbleMenuContainer }
