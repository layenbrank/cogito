import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode
} from 'react'

import type { HandleItem, PaneCollapsibleConfig, PaneItem, SplitterHandleProps, SplitterPaneProps } from './types'

const PANE_TYPE = Symbol.for('cogito.splitter.pane')
const HANDLE_TYPE = Symbol.for('cogito.splitter.handle')

function normalizeCollapsible(
  value: SplitterPaneProps['collapsible']
): PaneCollapsibleConfig {
  if (value === true) return { start: true, end: true, showIcon: 'auto' }
  if (!value) return {}
  return {
    start: Boolean(value.start),
    end: Boolean(value.end),
    showIcon: value.showIcon ?? 'auto'
  }
}

function parseChildren(children: ReactNode): {
  panes: PaneItem[]
  handles: (HandleItem | undefined)[]
} {
  const panes: PaneItem[] = []
  const handles: (HandleItem | undefined)[] = []

  const nodes = Children.toArray(children)
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (!isValidElement(node)) continue

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
      if (
        isValidElement(next) &&
        (next.type as { $$typeofMarker?: symbol }).$$typeofMarker === HANDLE_TYPE
      ) {
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

export { markHandleType, markPaneType, parseChildren }
