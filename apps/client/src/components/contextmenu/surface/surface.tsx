import { AnimatePresence, useReducedMotion } from 'motion/react'
import { useRef, type CSSProperties, type ReactNode } from 'react'

import { parseMotion } from '@/components/contextmenu/menu'
import type {
  MenuClassNames,
  MenuMotion,
  MenuSelectInfo,
  MenuStyles,
  ParsedMenuItem
} from '@/components/contextmenu/menu'
import type { Point, Rect } from '@/components/contextmenu/position'
import { buildSurfaceKeyboardActions } from './keyboard'
import { MenuItems } from './items'
import { MenuSurface } from './menu-surface'
import { useSurfaceHandlers } from './use-handlers'
import { useSurfaceOrigin } from './use-origin'
import { useSurfaceSubmenu } from './use-submenu'

const EXPAND_DELAY_MS = 100
const COLLAPSE_DELAY_MS = 160

interface SurfaceProps {
  items: ParsedMenuItem[]
  level: number
  keyPath: string[]
  path: string[]
  activeKey?: string
  classNames?: MenuClassNames
  styles?: MenuStyles
  motion?: MenuMotion
  offset?: [number, number]
  submenuOffset?: [number, number]
  boundaryPadding?: number
  expandDelay?: number
  collapseDelay?: number
  container: HTMLElement
  anchor: Point | Rect
  placement: 'pointer' | 'submenu'
  preferRight?: boolean
  content?: ReactNode
  renderItem?: (item: ParsedMenuItem, node: ReactNode) => ReactNode
  renderSurface?: (
    nodes: ReactNode,
    meta: { level: number; items: ParsedMenuItem[] }
  ) => ReactNode
  onpathChange: (path: string[]) => void
  onUpdateActive: (key: string | undefined) => void
  onSelect: (info: MenuSelectInfo) => void
  onClose: () => void
}

function findExpandedItem(items: ParsedMenuItem[], key: string | undefined) {
  if (!key) return undefined
  return items.find(function (item) {
    return item.key === key
  })
}

function hasSubmenuContent(item: ParsedMenuItem | undefined) {
  if (!item) return false
  return (item.content !== null && item.content !== undefined) || Boolean(item.children)
}

function Surface(props: SurfaceProps) {
  const isReduced = useReducedMotion()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const expandDelayMs = props.expandDelay ?? EXPAND_DELAY_MS
  const collapseDelayMs = props.collapseDelay ?? COLLAPSE_DELAY_MS
  const motion = parseMotion(
    props.level,
    props.level === 0 ? props.motion?.surface : props.motion?.submenu,
    Boolean(isReduced)
  )
  const expandedKey = props.path[props.keyPath.length]
  const expanded = findExpandedItem(props.items, expandedKey)

  const { origin, isMeasured, childAnchor } = useSurfaceOrigin({
    surfaceRef,
    anchor: props.anchor,
    placement: props.placement,
    offset: props.offset,
    submenuOffset: props.submenuOffset,
    boundaryPadding: props.boundaryPadding,
    container: props.container,
    preferRight: props.preferRight,
    items: props.items,
    expanded,
    path: props.path
  })

  const { expand, collapse, cancelPendingClose } = useSurfaceSubmenu({
    expandDelayMs,
    collapseDelayMs,
    keyPath: props.keyPath,
    onpathChange: props.onpathChange,
    onUpdateActive: props.onUpdateActive
  })

  const { selectItem, onItemMouseEnter, onItemPointerDown } = useSurfaceHandlers(
    props,
    expand,
    collapse
  )

  const { onKeyDown } = buildSurfaceKeyboardActions({
    items: props.items,
    keyPath: props.keyPath,
    activeKey: props.activeKey,
    onpathChange: props.onpathChange,
    onUpdateActive: props.onUpdateActive,
    onClose: props.onClose,
    selectItem
  })

  const surfaceStyle: CSSProperties = {
    ...props.styles?.surface,
    ...(props.level > 0 ? props.styles?.submenu : null),
    left: origin.left,
    top: origin.top,
    visibility: isMeasured ? 'visible' : 'hidden',
    pointerEvents: isMeasured ? 'auto' : 'none'
  }

  const itemsNode =
    props.content !== null && props.content !== undefined ? (
      props.content
    ) : (
      <MenuItems
        items={props.items}
        activeKey={props.activeKey}
        expandedKey={expandedKey}
        classNames={props.classNames}
        styles={props.styles}
        onItemMouseEnter={onItemMouseEnter}
        onItemPointerDown={onItemPointerDown}
        renderItem={props.renderItem}
      />
    )

  const surfaceContent = props.renderSurface
    ? props.renderSurface(itemsNode, { level: props.level, items: props.items })
    : itemsNode

  const showSubmenu = hasSubmenuContent(expanded) && Boolean(childAnchor)

  return (
    <>
      <MenuSurface
        ref={surfaceRef}
        level={props.level}
        classNames={props.classNames}
        surfaceStyle={surfaceStyle}
        motion={motion}
        flipX={origin.flipX}
        flipY={origin.flipY}
        onMouseEnter={cancelPendingClose}
        onKeyDown={onKeyDown}>
        {surfaceContent}
      </MenuSurface>

      <AnimatePresence>
        {showSubmenu && expanded && childAnchor ? (
          <Surface
            key={expanded.key}
            items={expanded.children ?? []}
            content={expanded.content}
            level={props.level + 1}
            keyPath={[...props.keyPath, expanded.key]}
            path={props.path}
            activeKey={props.activeKey}
            classNames={props.classNames}
            styles={props.styles}
            motion={props.motion}
            offset={props.offset}
            submenuOffset={props.submenuOffset}
            boundaryPadding={props.boundaryPadding}
            expandDelay={props.expandDelay}
            collapseDelay={props.collapseDelay}
            container={props.container}
            anchor={childAnchor}
            placement="submenu"
            preferRight={!origin.flipX}
            renderItem={props.renderItem}
            renderSurface={props.renderSurface}
            onpathChange={props.onpathChange}
            onUpdateActive={props.onUpdateActive}
            onSelect={props.onSelect}
            onClose={props.onClose}
          />
        ) : null}
      </AnimatePresence>
    </>
  )
}

export type { SurfaceProps }
export { Surface }
