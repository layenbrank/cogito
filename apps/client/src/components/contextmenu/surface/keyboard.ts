import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import { findFocusable, hasChildren } from '@/components/contextmenu/menu'
import type { ParsedMenuItem } from '@/components/contextmenu/menu'

interface SurfaceKeyboardOptions {
  items: ParsedMenuItem[]
  keyPath: string[]
  activeKey?: string
  onpathChange: (path: string[]) => void
  onUpdateActive: (key: string | undefined) => void
  onClose: () => void
  selectItem: (
    item: ParsedMenuItem,
    event: ReactKeyboardEvent | KeyboardEvent
  ) => void
}

function buildSurfaceKeyboardActions(options: SurfaceKeyboardOptions) {
  const focusable = findFocusable(options.items)

  const KEYBOARD_ACTIONS: Record<
    string,
    (event: ReactKeyboardEvent<HTMLDivElement>, currentIndex: number) => void
  > = {
    Escape: function (event) {
      event.preventDefault()
      if (options.keyPath.length > 0) {
        options.onpathChange(options.keyPath.slice(0, -1))
        return
      }
      options.onClose()
    },
    ArrowDown: function (event, currentIndex) {
      event.preventDefault()
      const next = focusable[(currentIndex + 1 + focusable.length) % focusable.length]
      options.onUpdateActive(next.key)
    },
    ArrowUp: function (event, currentIndex) {
      event.preventDefault()
      const next = focusable[(currentIndex - 1 + focusable.length) % focusable.length]
      options.onUpdateActive(next.key)
    },
    ArrowRight: function (event, currentIndex) {
      const current = focusable[currentIndex]
      if (!current || !hasChildren(current)) return
      event.preventDefault()
      options.onpathChange([...options.keyPath, current.key])
      if (current.content !== null && current.content !== undefined) {
        options.onUpdateActive(current.key)
        return
      }
      const nested = findFocusable(current.children ?? [])
      options.onUpdateActive(nested[0]?.key)
    },
    ArrowLeft: function (event) {
      if (options.keyPath.length === 0) return
      event.preventDefault()
      options.onpathChange(options.keyPath.slice(0, -1))
    },
    Enter: function (event, currentIndex) {
      const current = focusable[currentIndex]
      if (!current) return
      event.preventDefault()
      options.selectItem(current, event)
    },
    ' ': function (event, currentIndex) {
      const current = focusable[currentIndex]
      if (!current) return
      event.preventDefault()
      options.selectItem(current, event)
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (focusable.length === 0) return
    const action = KEYBOARD_ACTIONS[event.key]
    if (!action) return
    const currentIndex = focusable.findIndex(function (item) {
      return item.key === options.activeKey
    })
    action(event, currentIndex)
  }

  return { focusable, onKeyDown }
}

export type { SurfaceKeyboardOptions }
export { buildSurfaceKeyboardActions }
