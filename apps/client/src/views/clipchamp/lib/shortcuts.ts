import { useEffect } from 'react'

import { useClipchampStore } from '@/stores/clipchamp.ts'

function useClipchampShortcuts() {
  useEffect(function () {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTyping =
        tag === 'input' || tag === 'textarea' || target?.isContentEditable

      const mod = event.ctrlKey || event.metaKey
      const store = useClipchampStore.getState()

      if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        store.undo()
        return
      }
      if (mod && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
        event.preventDefault()
        store.redo()
        return
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        store.persistProject()
        return
      }

      if (isTyping) return

      if (event.key === ' ') {
        event.preventDefault()
        store.togglePlay()
        return
      }
      if (event.key.toLowerCase() === 's' && !mod) {
        event.preventDefault()
        store.splitAtPlayhead()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        store.removeSelected()
        return
      }
      if (event.key === 'Escape' && store.isFullscreen) {
        event.preventDefault()
        store.updateFullscreen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return function () {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}

export { useClipchampShortcuts }
