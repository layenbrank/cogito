"use client"

import type { Editor } from "@tiptap/react"
import { useCallback, useEffect, useState } from "react"

type Orientation = "horizontal" | "vertical" | "both"

interface MenuNavigationOptions<T> {
  /**
   * The Tiptap editor instance, if using with a Tiptap editor.
   */
  editor?: Editor | null
  /**
   * Reference to the container element for handling keyboard events.
   */
  containerRef?: React.RefObject<HTMLElement | null>
  /**
   * Search query that affects the selected item.
   */
  query?: string
  /**
   * Array of items to navigate through.
   */
  items: T[]
  /**
   * Callback fired when an item is selected.
   */
  onSelect?: (item: T) => void
  /**
   * Callback fired when the menu should close.
   */
  onClose?: () => void
  /**
   * The navigation orientation of the menu.
   * @default "vertical"
   */
  orientation?: Orientation
  /**
   * Whether to automatically select the first item when the menu opens.
   * @default true
   */
  autoSelectFirstItem?: boolean
}

/**
 * Hook that implements keyboard navigation for dropdown menus and command palettes.
 *
 * Handles arrow keys, tab, home/end, enter for selection, and escape to close.
 * Works with both Tiptap editors and regular DOM elements.
 *
 * @param options - Configuration options for the menu navigation
 * @returns Object containing the selected index and a setter function
 */
export function useMenuNavigation<T>({
  editor,
  containerRef,
  query,
  items,
  onSelect,
  onClose,
  orientation = "vertical",
  autoSelectFirstItem = true,
}: MenuNavigationOptions<T>) {
  /**
   * 选中项与「快照 query」一起存：query 变了就派生回首项（与原实现一致，只有 query
   * 非空时才重置），这样不用在 effect 里 setState。
   */
  const resetIndex = autoSelectFirstItem ? 0 : -1
  const [nav, updateNav] = useState<{ query: string | undefined; index: number }>(
    { query, index: resetIndex }
  )

  const selectedIndex = query && nav.query !== query ? resetIndex : nav.index

  const setSelectedIndex = useCallback(
    function (next: React.SetStateAction<number>) {
      updateNav(function (current) {
        const base =
          query && current.query !== query ? resetIndex : current.index
        return {
          query,
          index: typeof next === "function" ? next(base) : next,
        }
      })
    },
    [query, resetIndex]
  )

  useEffect(() => {
    const handleKeyboardNavigation = (event: KeyboardEvent) => {
      if (!items.length) return false

      const moveNext = () =>
        setSelectedIndex((currentIndex) => {
          if (currentIndex === -1) return 0
          return (currentIndex + 1) % items.length
        })

      const movePrev = () =>
        setSelectedIndex((currentIndex) => {
          if (currentIndex === -1) return items.length - 1
          return (currentIndex - 1 + items.length) % items.length
        })

      switch (event.key) {
        case "ArrowUp": {
          if (orientation === "horizontal") return false
          event.preventDefault()
          movePrev()
          return true
        }

        case "ArrowDown": {
          if (orientation === "horizontal") return false
          event.preventDefault()
          moveNext()
          return true
        }

        case "ArrowLeft": {
          if (orientation === "vertical") return false
          event.preventDefault()
          movePrev()
          return true
        }

        case "ArrowRight": {
          if (orientation === "vertical") return false
          event.preventDefault()
          moveNext()
          return true
        }

        case "Tab": {
          event.preventDefault()
          if (event.shiftKey) {
            movePrev()
          } else {
            moveNext()
          }
          return true
        }

        case "Home": {
          event.preventDefault()
          setSelectedIndex(0)
          return true
        }

        case "End": {
          event.preventDefault()
          setSelectedIndex(items.length - 1)
          return true
        }

        case "Enter": {
          if (event.isComposing) return false
          event.preventDefault()
          if (selectedIndex !== -1 && items[selectedIndex]) {
            onSelect?.(items[selectedIndex])
          }
          return true
        }

        case "Escape": {
          event.preventDefault()
          onClose?.()
          return true
        }

        default:
          return false
      }
    }

    let targetElement: HTMLElement | null = null

    if (editor) {
      targetElement = editor.view.dom
    } else if (containerRef?.current) {
      targetElement = containerRef.current
    }

    if (targetElement) {
      targetElement.addEventListener("keydown", handleKeyboardNavigation, true)

      return () => {
        targetElement?.removeEventListener(
          "keydown",
          handleKeyboardNavigation,
          true
        )
      }
    }

    return undefined
  }, [
    editor,
    containerRef,
    items,
    selectedIndex,
    setSelectedIndex,
    onSelect,
    onClose,
    orientation,
  ])

  return {
    selectedIndex: items.length ? selectedIndex : undefined,
    setSelectedIndex,
  }
}
