import { clsx } from 'clsx'
import { AnimatePresence } from 'motion/react'
import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref
} from 'react'
import { createPortal } from 'react-dom'

import { useDismiss, findFocusable, parseMenuItems } from '@/components/contextmenu/menu'
import type {
  MenuClassNames,
  MenuItem,
  MenuMotion,
  MenuSelectInfo,
  MenuStyles,
  ParsedMenuItem
} from '@/components/contextmenu/menu'
import { findBody } from '@/components/contextmenu/find-body'
import { MenuLayer, type LayerState } from '@/components/contextmenu/menu-layer'
import { type Point } from '@/components/contextmenu/position'

import '@/components/contextmenu/contextmenu.scss'

/** 默认 trigger：clone 时写入 data-contextmenu-trigger */
const TRIGGER = '[data-contextmenu-trigger]'

interface ContextMenuProps {
  /** 静态菜单；与 findItems 二选一，findItems 优先 */
  items?: MenuItem[]
  /** 按命中的 trigger 节点解析菜单（委托场景） */
  findItems?: (trigger: Element) => MenuItem[]
  children?: ReactNode
  disabled?: boolean
  visible?: boolean
  /** closest 选择器；自定义时不烙默认 data，由 root 委托 */
  trigger?: string
  className?: string
  classNames?: MenuClassNames
  styles?: MenuStyles
  motion?: MenuMotion
  offset?: [number, number]
  submenuOffset?: [number, number]
  boundaryPadding?: number
  expandDelay?: number
  collapseDelay?: number
  /** Portal 挂载点，默认 document.body */
  onTeleport?: () => HTMLElement
  renderItem?: (item: ParsedMenuItem, node: ReactNode) => ReactNode
  renderSurface?: (nodes: ReactNode, meta: { level: number; items: ParsedMenuItem[] }) => ReactNode
  /** 显隐受控回调 */
  onUpdateVisible?: (visible: boolean) => void
  onSelect?: (info: MenuSelectInfo) => void
}

interface TriggerElementProps {
  className?: string
  onContextMenu?: (event: ReactMouseEvent) => void
  ref?: Ref<HTMLElement>
  'data-contextmenu-trigger'?: string
}

function isInRoot(root: HTMLElement | null, node: Element | null) {
  if (!root || !node) return false
  return node === root || root.contains(node)
}

function pickItems(props: ContextMenuProps, trigger: Element) {
  if (props.findItems) return props.findItems(trigger)
  return props.items ?? []
}

function assignRef(ref: Ref<HTMLElement> | undefined, node: HTMLElement | null) {
  if (typeof ref === 'function') {
    ref(node)
    return
  }
  if (ref && typeof ref === 'object') {
    ;(ref as { current: HTMLElement | null }).current = node
  }
}

function Root(props: ContextMenuProps) {
  const isControlled = props.visible !== undefined
  const isDelegate = props.trigger !== null && props.trigger !== undefined
  const [innerVisible, setInnerVisible] = useState(false)
  const [layer, setLayer] = useState<LayerState | null>(null)
  const [session, setSession] = useState(0)
  const [path, setPath] = useState<string[]>([])
  const [activeKey, setActiveKey] = useState<string | undefined>()
  const rootRef = useRef<HTMLElement | null>(null)
  const updateVisibleRef = useRef<(next: boolean) => void>(function () {})
  const visibleRef = useRef(false)
  const itemsRef = useRef(props.items)
  const findItemsRef = useRef(props.findItems)
  const controlledVisibleRef = useRef(props.visible)

  const visible = isControlled ? Boolean(props.visible) : innerVisible
  const triggerSelector = props.trigger ?? TRIGGER

  useEffect(
    function () {
      visibleRef.current = visible
    },
    [visible]
  )

  function updateVisible(next: boolean) {
    if (!isControlled) setInnerVisible(next)
    props.onUpdateVisible?.(next)
    if (!next) {
      setPath([])
      setActiveKey(undefined)
    }
  }

  useEffect(function () {
    updateVisibleRef.current = updateVisible
  })

  useEffect(
    function () {
      itemsRef.current = props.items
      findItemsRef.current = props.findItems
    },
    [props.items, props.findItems]
  )

  function clearLayer() {
    setLayer(null)
    setPath([])
    setActiveKey(undefined)
  }

  function presentAt(point: Point, items: MenuItem[]) {
    if (props.disabled) return
    if (!items.length) return
    const parsed = parseMenuItems(items)
    const focusable = findFocusable(parsed)
    // 换 session key 重播入场；onExitComplete 仅在关闭时清 layer，避免拆掉新层
    setSession(function (n) {
      return n + 1
    })
    setLayer({ anchor: point, items: parsed })
    setPath([])
    setActiveKey(focusable[0]?.key)
    if (!isControlled) setInnerVisible(true)
    props.onUpdateVisible?.(true)
  }

  function onContextMenu(event: ReactMouseEvent) {
    if (props.disabled) return
    if (event.shiftKey) return

    const target = event.target
    if (!(target instanceof Element)) return
    const node = target.closest(triggerSelector)
    if (!node || !isInRoot(rootRef.current, node)) return

    const items = pickItems(props, node)
    if (!items.length) return

    event.preventDefault()
    event.stopPropagation()
    presentAt({ x: event.clientX, y: event.clientY }, items)
  }

  function onSelect(info: MenuSelectInfo) {
    props.onSelect?.(info)
    updateVisible(false)
  }

  useDismiss({
    visible,
    onClose() {
      updateVisible(false)
    }
  })

  // 已打开时：capture 阶段若 closest 非本 root 内 trigger，关闭自身
  useEffect(
    function () {
      if (!visible) return

      function onDocumentContextMenu(event: MouseEvent) {
        const target = event.target
        if (!(target instanceof Element)) {
          updateVisibleRef.current(false)
          return
        }
        const node = target.closest(triggerSelector)
        if (!isInRoot(rootRef.current, node)) {
          updateVisibleRef.current(false)
        }
      }

      document.addEventListener('contextmenu', onDocumentContextMenu, true)
      return function () {
        document.removeEventListener('contextmenu', onDocumentContextMenu, true)
      }
    },
    [visible, triggerSelector]
  )

  // 受控打开请走 presentAt / ContextMenu.Host；勿用 effect 跟 prop 同步 layer
  useEffect(
    function () {
      controlledVisibleRef.current = props.visible
    },
    [props.visible]
  )

  const child = props.children
  let trigger: ReactNode = child

  if (child === undefined || child === null) trigger = null
  else if (isValidElement(child)) {
    const element = child as ReactElement<TriggerElementProps>
    /* eslint-disable react-hooks/refs -- cloneElement 合并子组件 ref，仅在 ref 回调里写 .current */
    const childRef = element.props.ref
    trigger = cloneElement(element, {
      className: clsx(element.props.className, props.className, props.classNames?.root),
      ...(isDelegate ? {} : { 'data-contextmenu-trigger': '' }),
      onContextMenu(event: ReactMouseEvent) {
        element.props.onContextMenu?.(event)
        onContextMenu(event)
      },
      ref(node: HTMLElement | null) {
        rootRef.current = node
        assignRef(childRef, node)
      }
    })
  } else {
    trigger = (
      <div
        ref={function (node) {
          rootRef.current = node
        }}
        {...(isDelegate ? {} : { 'data-contextmenu-trigger': '' })}
        className={clsx('contextmenu-trigger', props.className, props.classNames?.root)}
        style={props.styles?.root}
        onContextMenu={onContextMenu}>
        {child}
      </div>
    )
  }

  const container = (props.onTeleport ?? findBody)()

  return (
    <>
      {trigger}
      {createPortal(
        <AnimatePresence
          onExitComplete={function () {
            // 已打开时 session remount 也会触发 exit；仅真正关闭后清 layer
            if (!visibleRef.current) clearLayer()
          }}>
          {visible && layer ? (
            <MenuLayer
              key={`contextmenu-${session}`}
              layer={layer}
              path={path}
              activeKey={activeKey}
              classNames={props.classNames}
              styles={props.styles}
              motion={props.motion}
              offset={props.offset}
              submenuOffset={props.submenuOffset}
              boundaryPadding={props.boundaryPadding}
              expandDelay={props.expandDelay}
              collapseDelay={props.collapseDelay}
              container={container}
              renderItem={props.renderItem}
              renderSurface={props.renderSurface}
              onUpdatePath={setPath}
              onUpdateActive={setActiveKey}
              onSelect={onSelect}
              onClose={function () {
                updateVisible(false)
              }}
            />
          ) : null}
        </AnimatePresence>,
        container
      )}
    </>
  )
}

export type { ContextMenuProps, LayerState }
export { Root }
