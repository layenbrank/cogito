import { LAYER_OVERLAY, LAYER_TRIGGER } from '@i-thinking/design/lib/surface'

/**
 * 只认 `data-layer`，取值与设计系统的 `LAYER_OVERLAY` / `LAYER_TRIGGER` 相同。
 * 可见的 overlay 与网页矩形相交时，子 WebView 沉下去。
 */

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const LAYER_QUERY = `[data-layer="${LAYER_OVERLAY}"]`
const LAYER_TRIGGER_QUERY = `[data-layer="${LAYER_TRIGGER}"]`

function rectsOverlap(a: Rect, b: Rect) {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right - left > 0.5 && bottom - top > 0.5
}

function isShown(node: HTMLElement) {
  if (node.hidden || node.closest('[hidden]')) return false
  const style = getComputedStyle(node)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function findShownLayer() {
  const nodes = document.querySelectorAll(LAYER_QUERY)
  for (const node of nodes) {
    if (node instanceof HTMLElement && isShown(node)) return node
  }
  return null
}

function findCoveringLayer(page: Rect | null) {
  if (!page || page.width < 1 || page.height < 1) return null
  const nodes = document.querySelectorAll(LAYER_QUERY)
  for (const node of nodes) {
    if (!(node instanceof HTMLElement) || !isShown(node)) continue
    const box = node.getBoundingClientRect()
    if (rectsOverlap(page, { x: box.x, y: box.y, width: box.width, height: box.height })) {
      return node
    }
  }
  return null
}

export { LAYER_QUERY, LAYER_TRIGGER_QUERY, rectsOverlap, findShownLayer, findCoveringLayer }
export type { Rect }
