// @ts-nocheck
'use client'

import { forwardRef, useCallback } from 'react'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor'

// --- Tiptap UI ---
import type { UseTableAddRowColumnConfig } from '@/components/tiptap-node/table-node/ui/table-add-row-column-button/use-table-add-row-column.ts'
import { useTableAddRowColumn } from '@/components/tiptap-node/table-node/ui/table-add-row-column-button/use-table-add-row-column.ts'

// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button/button.tsx'
import { Button } from '@/components/tiptap-ui-primitive/button/button.tsx'

export interface TableAddRowColumnButtonProps
  extends Omit<ButtonProps, 'type'>, UseTableAddRowColumnConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string
}

/**
 * Button component for adding a table row/column in a Tiptap editor.
 *
 * For custom button implementations, use the `useTableAddRowColumn` hook instead.
 */
export const TableAddRowColumnButton = forwardRef<
  HTMLButtonElement,
  TableAddRowColumnButtonProps
>(
  (
    {
      editor: providedEditor,
      index,
      orientation,
      side,
      tablePos,
      hideWhenUnavailable = false,
      onAdded,
      text,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, handleAdd, label, canAddRowColumn, Icon } =
      useTableAddRowColumn({
        editor,
        index,
        orientation,
        side,
        tablePos,
        hideWhenUnavailable,
        onAdded
      })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleAdd()
      },
      [handleAdd, onClick]
    )

    if (!isVisible) {
      return null
    }

    return (
      <Button
        type="button"
        disabled={!canAddRowColumn}
        data-style="ghost"
        data-active-state="off"
        data-disabled={!canAddRowColumn}
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

TableAddRowColumnButton.displayName = 'TableAddRowColumnButton'
