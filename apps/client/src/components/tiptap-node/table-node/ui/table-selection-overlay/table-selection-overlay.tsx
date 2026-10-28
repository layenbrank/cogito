// @ts-nocheck
import type { Editor } from '@tiptap/react'
import { FloatingPortal } from '@floating-ui/react'

import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'
import { createCornerHandleStyles, type ResizeHandle } from './selection-geometry.ts'
import { useTableSelectionOverlay } from './use-table-selection-overlay.ts'
import { t } from '@/views/knowledge/locale.ts'

export interface TableSelectionOverlayProps {
  editor?: Editor | null
  cellMenu?: React.ComponentType<{
    onOpenChange?: (isOpen: boolean) => void
    editor?: Editor | null
    onResizeStart?: (handle: ResizeHandle) => (event: React.MouseEvent) => void
  }>
  showResizeHandles?: boolean
  onMenuOpenChange?: (isOpen: boolean) => void
}

export function TableSelectionOverlay({
  editor: providedEditor,
  cellMenu: CellMenu,
  showResizeHandles = true,
  onMenuOpenChange
}: TableSelectionOverlayProps) {
  const { editor } = useTiptapEditor(providedEditor)
  const {
    isVisible,
    selectionRect,
    activeHandle,
    isMenuOpen,
    refs,
    floatingStyles,
    containerRef,
    createResizeHandler,
    handleMenuOpenChange
  } = useTableSelectionOverlay({
    editor,
    showResizeHandles,
    onMenuOpenChange
  })

  if (!isVisible || !selectionRect) {
    return null
  }

  if (!editor) return null

  function renderCellMenu() {
    if (!CellMenu) return null

    return (
      <span
        onMouseDown={(e) => e.stopPropagation()}
        style={{ pointerEvents: 'auto' }}>
        <CellMenu
          onOpenChange={handleMenuOpenChange}
          editor={editor}
          onResizeStart={createResizeHandler}
        />
      </span>
    )
  }

  const portalRoot = containerRef.current?.isConnected
    ? containerRef.current
    : undefined

  return (
    <FloatingPortal root={portalRoot}>
      <div
        ref={refs.setFloating}
        style={{
          ...floatingStyles,
          pointerEvents: 'none',
          zIndex: 10
        }}>
        <div className="tiptap-table-selection-overlay">
          <div
            style={{
              position: 'absolute',
              width: selectionRect.width,
              height: selectionRect.height,
              zIndex: 2,
              borderRadius: 2,
              top: 0,
              left: 0
            }}
          />

          <div
            style={{
              position: 'absolute',
              width: selectionRect.width,
              height: selectionRect.height,
              border: `2px solid var(--primary)`,
              borderRadius: 2,
              zIndex: 3,
              top: 0,
              left: 0
            }}>
            {renderCellMenu()}

            {showResizeHandles && (
              <>
                {(['tl', 'tr', 'bl', 'br'] as const).map(function (corner) {
                  return (
                    <button
                      key={corner}
                      type="button"
                      tabIndex={-1}
                      aria-label={t('EDITOR_TABLE_RESIZE', { corner })}
                      style={createCornerHandleStyles(
                        corner,
                        !activeHandle || activeHandle === corner,
                        isMenuOpen
                      )}
                      onMouseDown={createResizeHandler(corner)}
                    />
                  )
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </FloatingPortal>
  )
}
