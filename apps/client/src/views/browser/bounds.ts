/**
 * 浏览窗口内容槽的几何。
 *
 * 只提供「量」与「能不能摆」两件事 —— 目标矩形一律来自布局后的实测（ResizeObserver），
 * 不再用常量推算：侧栏宽度是 DOM 的属性，写死一份计算会在改布局后悄悄失配。
 */
const SIDEBAR_OPEN = 240
const SIDEBAR_SHUT = 48

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

function findNodeBounds(node: HTMLElement | null): Bounds {
  if (!node) return { x: 0, y: 0, width: 0, height: 0 }
  const rect = node.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function canPlace(bounds: Bounds) {
  return bounds.width >= 1 && bounds.height >= 1
}

export { SIDEBAR_OPEN, SIDEBAR_SHUT, findNodeBounds, canPlace }
export type { Bounds }
