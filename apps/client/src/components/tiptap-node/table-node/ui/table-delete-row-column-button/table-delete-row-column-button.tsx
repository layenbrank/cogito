// @ts-nocheck
'use client'

import { forwardRef, useCallback } from 'react'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor'

// --- Tiptap UI ---
import type { UseTableDeleteRowColumnConfig } from '@/components/tiptap-node/table-node/ui/table-delete-row-column-button/use-table-delete-row-column.ts'
import { useTableDeleteRowColumn } from '@/components/tiptap-node/table-node/ui/table-delete-row-column-button/use-table-delete-row-column.ts'

// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button/button.tsx'
import { Button } from '@/components/tiptap-ui-primitive/button/button.tsx'

export interface TableDeleteRowColumnButtonProps
  extends Omit<ButtonProps, 'type'>, UseTableDeleteRowColumnConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string
}

/**
 * Button component for deleting a table row/column in a Tiptap editor.
 *
 * For custom button implementations, use the `useTableDeleteRowColumn` hook instead.
 */
export const TableDeleteRowColumnButton = forwardRef<
  HTMLButtonElement,
  TableDeleteRowColumnButtonProps
>(
  (
    {
      editor: providedEditor,
      index,
      orientation,
      tablePos,
      hideWhenUnavailable = false,
      onDeleted,
      text,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, handleDelete, label, canDeleteRowColumn, Icon } =
      useTableDeleteRowColumn({
        editor,
        index,
        orientation,
        tablePos,
        hideWhenUnavailable,
        onDeleted
      })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleDelete()
      },
      [handleDelete, onClick]
    )

    if (!isVisible) {
      return null
    }

    return (
      <Button
        type="button"
        disabled={!canDeleteRowColumn}
        data-style="ghost"
        data-active-state="off"
        data-disabled={!canDeleteRowColumn}
        role="button"
        tabIndex={-1}
        aria-label={label}
        aria-pressed={false}
        tooltip={label}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}>
        {children ?? (
          <>
            <Icon className="size-3.5 shrink-0" />
            {text && <span className="truncate text-xs">{text}</span>}
          </>
        )}
      </Button>
    )
  }
)

TableDeleteRowColumnButton.displayName = 'TableDeleteRowColumnButton'
