import type { TargetAndTransition, Transition } from 'motion/react'
import { useEffect, useRef } from 'react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from 'react'

type MenuItemKind = 'item' | 'divider' | 'group'

interface MenuSelectInfo {
  key: string
  keyPath: string[]
  event: ReactPointerEvent | ReactKeyboardEvent | KeyboardEvent
  item: MenuItem
}

interface MenuItem {
  key?: string
  type?: MenuItemKind
  label?: ReactNode
  icon?: ReactNode
  shortcut?: ReactNode
  danger?: boolean
  disabled?: boolean
  /** 自定义子层内容；有值时悬停展开该内容，不再渲染 children 列表 */
  content?: ReactNode
  children?: MenuItem[]
  className?: string
  style?: CSSProperties
  onSelect?: (info: MenuSelectInfo) => void
}

interface MenuClassNames {
  root?: string
  surface?: string
  item?: string
  icon?: string
  label?: string
  shortcut?: string
  arrow?: string
  submenu?: string
  divider?: string
}

interface MenuStyles {
  root?: CSSProperties
  surface?: CSSProperties
  item?: CSSProperties
  icon?: CSSProperties
  label?: CSSProperties
  shortcut?: CSSProperties
  arrow?: CSSProperties
  submenu?: CSSProperties
  divider?: CSSProperties
}

interface MenuMotionSlot {
  initial?: TargetAndTransition
  animate?: TargetAndTransition
  exit?: TargetAndTransition
  transition?: Transition
}

/** 覆盖浮层动效（含 transform） */
interface MenuMotion {
  surface?: MenuMotionSlot
  submenu?: MenuMotionSlot
}

interface ParsedMenuItem extends MenuItem {
  key: string
  type: MenuItemKind
  children?: ParsedMenuItem[]
}

function parseItemKind(item: MenuItem): MenuItemKind {
  if (item.type) return item.type
  if (item.children && item.children.length > 0 && item.label && !item.key) {
    return 'group'
  }
  return 'item'
}

function parseMenuItems(items: MenuItem[], pathPrefix = ''): ParsedMenuItem[] {
  return items.map(function (item, index) {
    const kind = parseItemKind(item)
    const key =
      item.key ??
      (kind === 'divider' ? `${pathPrefix}divider-${index}` : `${pathPrefix}item-${index}`)
    const children = item.children ? parseMenuItems(item.children, `${key}.`) : undefined

    return {
      ...item,
      key,
      type: kind,
      children
    }
  })
}

function findFocusable(items: ParsedMenuItem[]): ParsedMenuItem[] {
  const result: ParsedMenuItem[] = []

  function walk(nodes: ParsedMenuItem[]) {
    for (const node of nodes) {
      if (node.type === 'divider') continue
      if (node.type === 'group') {
        if (node.children) walk(node.children)
        continue
      }
      if (!node.disabled) result.push(node)
    }
  }

  walk(items)
  return result
}

function hasChildren(item: ParsedMenuItem) {
  if ((item.content !== null && item.content !== undefined)) return true
  return Boolean(item.children && item.children.length > 0)
}

const EASE_IN = [0.4, 0, 1, 1] as [number, number, number, number]

/** 一级：自锚点弹出（缩放 + 下移） */
const SURFACE_MOTION: MenuMotionSlot = {
  initial: { opacity: 0, scale: 0.88, y: -12 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: {
    opacity: 0,
    scale: 0.94,
    y: -6,
    transition: { duration: 0.12, ease: EASE_IN }
  },
  transition: { type: 'spring', stiffness: 520, damping: 32, mass: 0.7 }
}

/** 二级：自父项侧滑弹出 */
const SUBMENU_MOTION: MenuMotionSlot = {
  initial: { opacity: 0, scale: 0.9, x: -12 },
  animate: { opacity: 1, scale: 1, x: 0 },
  exit: {
    opacity: 0,
    scale: 0.94,
    x: -6,
    transition: { duration: 0.1, ease: EASE_IN }
  },
  transition: { type: 'spring', stiffness: 560, damping: 34, mass: 0.65 }
}

const REDUCED_MOTION: MenuMotionSlot = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.08 }
}

function parseMotion(
  level: number,
  override?: MenuMotionSlot,
  isReduced?: boolean
): MenuMotionSlot {
  if (isReduced) {
    return {
      initial: override?.initial ?? REDUCED_MOTION.initial,
      animate: override?.animate ?? REDUCED_MOTION.animate,
      exit: override?.exit ?? REDUCED_MOTION.exit,
      transition: override?.transition ?? REDUCED_MOTION.transition
    }
  }
  const base = level === 0 ? SURFACE_MOTION : SUBMENU_MOTION
  return {
    initial: override?.initial ?? base.initial,
    animate: override?.animate ?? base.animate,
    exit: override?.exit ?? base.exit,
    transition: override?.transition ?? base.transition
  }
}

const SURFACE_CLASS = 'contextmenu-surface'
const DISMISS_GRACE_MS = 16

function isInsideMenu(event: Event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  for (const node of path) {
    if (!(node instanceof Element)) continue
    if (node.classList.contains(SURFACE_CLASS)) return true
  }
  const target = event.target
  if (!(target instanceof Node)) return false
  const surfaces = document.querySelectorAll(`.${SURFACE_CLASS}`)
  for (const surface of surfaces) {
    if (surface.contains(target)) return true
  }
  return false
}

interface DismissOptions {
  visible: boolean
  onClose: () => void
  graceMs?: number
}

function useDismiss(options: DismissOptions) {
  const { visible, onClose, graceMs = DISMISS_GRACE_MS } = options
  const shownAtRef = useRef(0)
  const onCloseRef = useRef(onClose)

  useEffect(
    function () {
      onCloseRef.current = onClose
    },
    [onClose]
  )

  useEffect(
    function () {
      if (!visible) return
      shownAtRef.current = Date.now()

      function onPointerDown(event: PointerEvent) {
        if (event.button !== 0) return
        if (Date.now() - shownAtRef.current < graceMs) return
        if (isInsideMenu(event)) return
        onCloseRef.current()
      }

      function onKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') onCloseRef.current()
      }

      function onResize() {
        onCloseRef.current()
      }

      document.addEventListener('pointerdown', onPointerDown)
      document.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('resize', onResize)
      return function () {
        document.removeEventListener('pointerdown', onPointerDown)
        document.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('resize', onResize)
      }
    },
    [visible, graceMs]
  )
}

export type {
  MenuItemKind,
  MenuSelectInfo,
  MenuItem,
  MenuClassNames,
  MenuStyles,
  MenuMotionSlot,
  MenuMotion,
  ParsedMenuItem,
  DismissOptions
}

export {
  parseMenuItems,
  findFocusable,
  hasChildren,
  SURFACE_MOTION,
  SUBMENU_MOTION,
  parseMotion,
  isInsideMenu,
  useDismiss,
  DISMISS_GRACE_MS,
  SURFACE_CLASS
}
