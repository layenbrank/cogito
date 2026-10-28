// @ts-nocheck
'use client'

import { forwardRef, useCallback } from 'react'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

// --- Tiptap UI ---
import type { UseTableDuplicateRowColumnConfig } from '@/components/tiptap-node/table-node/ui/table-duplicate-row-column-button/use-table-duplicate-row-column.ts'
import { useTableDuplicateRowColumn } from '@/components/tiptap-node/table-node/ui/table-duplicate-row-column-button/use-table-duplicate-row-column.ts'

// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button/button.tsx'
import { Button } from '@/components/tiptap-ui-primitive/button/button.tsx'

export interface TableDuplicateRowColumnButtonProps
  extends Omit<ButtonProps, 'type'>, UseTableDuplicateRowColumnConfig {
  text?: string
}

export const TableDuplicateRowColumnButton = forwardRef<
  HTMLButtonElement,
  TableDuplicateRowColumnButtonProps
>(
  (
    {
      editor: providedEditor,
      index,
      orientation,
      tablePos,
      hideWhenUnavailable = false,
      onDuplicated,
      text,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, handleDuplicate, label, canDuplicateRowColumn, Icon } =
      useTableDuplicateRowColumn({
        editor,
        index,
        orientation,
        tablePos,
        hideWhenUnavailable,
        onDuplicated
      })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleDuplicate()
      },
      [handleDuplicate, onClick]
    )

    if (!isVisible) {
      return null
    }

    return (
      <Button
        type="button"
        disabled={!canDuplicateRowColumn}
        data-style="ghost"
        data-active-state="off"
        data-disabled={!canDuplicateRowColumn}
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

TableDuplicateRowColumnButton.displayName = 'TableDuplicateRowColumnButton'
