/**
 * TipTap 浮层关闭后的焦点：避免 Base UI 把焦点还回 trigger（蓝环 + Tooltip），
 * 并尽量回到同一棵树里的 ProseMirror。
 */

/**
 * 从触发点向上找同树内的 `.ProseMirror`（工具栏与编辑器的共同祖先）。
 * 不回退到 `document.querySelector`，避免多编辑器挂错实例。
 */
function findComposerDom(anchor: HTMLElement | null | undefined): HTMLElement | null {
  let node: HTMLElement | null = anchor ?? null
  while (node) {
    const found = node.querySelector<HTMLElement>('.ProseMirror')
    if (found) return found
    node = node.parentElement
  }
  return null
}

/**
 * 关菜单/气泡后：焦点若在 trigger 或落到 body，则交回编辑器；
 * 已在编辑器或其它可聚焦控件上则不动（例如点到另一工具栏按钮）。
 * 用 rAF 避开 FloatingFocusManager returnFocus 的 microtask 时序。
 */
function restoreComposerFocus(anchor: HTMLElement | null | undefined): void {
  requestAnimationFrame(function () {
    const composer = findComposerDom(anchor)
    if (!composer) return

    const active = document.activeElement
    if (active instanceof HTMLElement) {
      if (active === composer || active.closest('.ProseMirror')) return
      const isOnTrigger = Boolean(
        anchor && (active === anchor || anchor.contains(active))
      )
      if (
        !isOnTrigger &&
        active !== document.body &&
        active !== document.documentElement
      ) {
        return
      }
    }

    composer.focus()
  })
}

export { findComposerDom, restoreComposerFocus }
