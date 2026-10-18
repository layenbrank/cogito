import { BROWSER_BAR } from '@/features/browser-bar/metrics'

const TOOLBAR = BROWSER_BAR
const SIDEBAR_OPEN = 240
const SIDEBAR_SHUT = 48
const SIDEBAR_MOTION_MS = 200

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** 侧栏动画开始前的目标矩形。不读动画中的布局。 */
function findTargetBounds(windowWidth: number, windowHeight: number, sidebar: number): Bounds {
  const x = sidebar
  const y = TOOLBAR
  return {
    x,
    y,
    width: Math.max(0, windowWidth - x),
    height: Math.max(0, windowHeight - y)
  }
}

function findNodeBounds(node: HTMLElement | null): Bounds {
  if (!node) return { x: 0, y: 0, width: 0, height: 0 }
  const rect = node.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function canPlace(bounds: Bounds) {
  return bounds.width >= 1 && bounds.height >= 1
}

export {
  TOOLBAR,
  SIDEBAR_OPEN,
  SIDEBAR_SHUT,
  SIDEBAR_MOTION_MS,
  findTargetBounds,
  findNodeBounds,
  canPlace
}
export type { Bounds }
