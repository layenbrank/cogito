import { Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'

import type {
  HandleItem,
  PaneCollapsibleConfig,
  PaneItem,
  SplitterHandleProps,
  SplitterPaneProps
} from './types'

const PANE_TYPE = Symbol.for('cogito.splitter.pane')
const HANDLE_TYPE = Symbol.for('cogito.splitter.handle')

function normalizeCollapsible(value: SplitterPaneProps['collapsible']): PaneCollapsibleConfig {
  if (value === true) return { start: true, end: true, showIcon: 'auto' }
  if (!value) return {}
  return {
    start: Boolean(value.start),
    end: Boolean(value.end),
    showIcon: value.showIcon ?? 'auto'
  }
}

/**
 * 展开数组与 Fragment。
 * React 19 的 Children.toArray 不再展开 Fragment（会留下 Symbol(react.fragment)），
 * 条件渲染 `<>…pane…</>` 会被丢掉，侧栏/底栏开关看起来像 noop。
 */
function flattenElements(children: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (children === null || children === undefined || typeof children === 'boolean') {
    return out
  }
  if (Array.isArray(children)) {
    for (const child of children) flattenElements(child, out)
    return out
  }
  if (!isValidElement(children)) return out
  if (children.type === Fragment) {
    flattenElements((children.props as { children?: ReactNode }).children, out)
    return out
  }
  out.push(children)
  return out
}

function parseChildren(children: ReactNode): {
  panes: PaneItem[]
  handles: (HandleItem | undefined)[]
} {
  const panes: PaneItem[] = []
  const handles: (HandleItem | undefined)[] = []

  const nodes = flattenElements(children)
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (!node) continue

    const type = (node.type as { $$typeofMarker?: symbol }).$$typeofMarker
    if (type === PANE_TYPE) {
      const props = node.props as SplitterPaneProps
      panes.push({
        id: props.id,
        defaultSize: props.defaultSize,
        min: props.min,
        max: props.max,
        collapsedSize: props.collapsedSize ?? 0,
        collapsible: normalizeCollapsible(props.collapsible),
        preservePixel: Boolean(props.preservePixel),
        resizable: props.resizable !== false,
        destroyOnHidden: Boolean(props.destroyOnHidden),
        className: props.className,
        style: props.style,
        paneRef: props.paneRef,
        onResize: props.onResize,
        children: props.children
      })
      // 若下一节点不是显式 Handle，先占位；后面补默认 handle
      const next = nodes[i + 1]
      if (next && (next.type as { $$typeofMarker?: symbol }).$$typeofMarker === HANDLE_TYPE) {
        const handleProps = next.props as SplitterHandleProps
        handles.push({
          withHandle: Boolean(handleProps.withHandle),
          className: handleProps.className,
          disabled: Boolean(handleProps.disabled),
          disableDoubleClick: Boolean(handleProps.disableDoubleClick),
          collapse: handleProps.collapse
        })
        i += 1
      } else {
        handles.push(undefined)
      }
    }
  }

  // 最后一个 pane 后不应有 handle
  if (handles.length === panes.length && panes.length > 0) {
    handles.pop()
  }
  while (handles.length < panes.length - 1) {
    handles.push(undefined)
  }

  return { panes, handles }
}

function markPaneType<T>(component: T): T {
  ;(component as { $$typeofMarker?: symbol }).$$typeofMarker = PANE_TYPE
  return component
}

function markHandleType<T>(component: T): T {
  ;(component as { $$typeofMarker?: symbol }).$$typeofMarker = HANDLE_TYPE
  return component
}

export { flattenElements, markHandleType, markPaneType, parseChildren }
