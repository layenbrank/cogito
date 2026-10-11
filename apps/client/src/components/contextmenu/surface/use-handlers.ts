import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from 'react'

import { hasChildren } from '@/components/contextmenu/menu'
import type { MenuSelectInfo, ParsedMenuItem } from '@/components/contextmenu/menu'

interface SurfaceHandlerProps {
  keyPath: string[]
  path: string[]
  onpathChange: (path: string[]) => void
  onUpdateActive: (key: string | undefined) => void
  onSelect: (info: MenuSelectInfo) => void
}

function useSurfaceHandlers(
  props: SurfaceHandlerProps,
  expand: (key: string) => void,
  collapse: () => void
) {
  function selectItem(
    item: ParsedMenuItem,
    event: ReactPointerEvent | ReactKeyboardEvent | KeyboardEvent
  ) {
    if (item.disabled) return
    if (hasChildren(item)) {
      props.onpathChange([...props.keyPath, item.key])
      props.onUpdateActive(item.key)
      return
    }
    const info: MenuSelectInfo = {
      key: item.key,
      keyPath: [...props.keyPath, item.key],
      event,
      item
    }
    item.onSelect?.(info)
    props.onSelect(info)
  }

  function onItemMouseEnter(item: ParsedMenuItem) {
    props.onUpdateActive(item.key)
    if (item.disabled) return
    if (hasChildren(item)) {
      expand(item.key)
      return
    }
    if (props.path.length > props.keyPath.length) collapse()
  }

  function onItemPointerDown(event: ReactPointerEvent, item: ParsedMenuItem) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    selectItem(item, event)
  }

  return { selectItem, onItemMouseEnter, onItemPointerDown }
}

export { useSurfaceHandlers }
