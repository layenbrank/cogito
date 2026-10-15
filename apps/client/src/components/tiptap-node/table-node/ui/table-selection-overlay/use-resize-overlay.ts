// @ts-nocheck
'use client'

import { useEffect, useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { columnResizingPluginKey } from '@tiptap/pm/tables'
import type { Transaction } from '@tiptap/pm/state'

export function useResizeOverlay(
  editor: Editor | null,
  updateSelectionRect: () => void
) {
  const rafId = useRef<number | null>(null)

  const stopLoop = useCallback(() => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current)
      rafId.current = null
    }
  }, [])

  const startLoop = useCallback(() => {
    if (rafId.current !== null) return
    const tick = () => {
      if (!editor || editor.isDestroyed) {
        stopLoop()
        return
      }
      try {
        const st = columnResizingPluginKey.getState(editor.state)
        const dragging = !!st?.dragging
        updateSelectionRect()
        if (dragging) {
          rafId.current = requestAnimationFrame(tick)
        } else {
          stopLoop()
          updateSelectionRect()
        }
      } catch (error) {
        console.debug('[TableOverlay] resize loop stopped:', error)
        stopLoop()
      }
    }
    rafId.current = requestAnimationFrame(tick)
  }, [editor, updateSelectionRect, stopLoop])

  useEffect(() => {
    if (!editor) return

    const onTx = ({ transaction }: { transaction: Transaction }) => {
      // this is for non-resize txs that may affect selection
      updateSelectionRect()

      const meta = transaction.getMeta(columnResizingPluginKey)
      if (!meta) return

      // drag start
      if (
        Object.prototype.hasOwnProperty.call(meta, 'setDragging') &&
        meta.setDragging
      ) {
        startLoop()
      }

      // drag end is also a tx with setDragging: null — rAF loop will notice and stop itself
      if (
        Object.prototype.hasOwnProperty.call(meta, 'setDragging') &&
        meta.setDragging == null
      ) {
        // if loop missed it for any reason, force a stop + final sync
        stopLoop()
        updateSelectionRect()
      }

      // handle-only hover (optional): update once for cursor changes, etc.
      if (Object.prototype.hasOwnProperty.call(meta, 'setHandle')) {
        updateSelectionRect()
      }
    }

    editor.on('transaction', onTx)
    return () => {
      editor.off('transaction', onTx)
      stopLoop()
    }
  }, [editor, startLoop, stopLoop, updateSelectionRect])
}
