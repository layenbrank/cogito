// @ts-nocheck
import { forwardRef, useCallback } from 'react'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor'

// --- Tiptap UI ---
import type { UseTableSortRowColumnConfig } from '@/components/tiptap-node/table-node/ui/table-sort-row-column-button/use-table-sort-row-column.ts'
import { useTableSortRowColumn } from '@/components/tiptap-node/table-node/ui/table-sort-row-column-button/use-table-sort-row-column.ts'

// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button/button.tsx'
import { Button } from '@/components/tiptap-ui-primitive/button/button.tsx'

export interface TableSortRowColumnButtonProps
  extends Omit<ButtonProps, 'type'>, UseTableSortRowColumnConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string
}

/**
 * Button component for sorting a table row/column in a Tiptap editor.
 *
 * For custom button implementations, use the `useTableSortRowColumn` hook instead.
 */
export const TableSortRowColumnButton = forwardRef<
  HTMLButtonElement,
  TableSortRowColumnButtonProps
>(
  (
    {
      editor: providedEditor,
      index,
      orientation,
      direction,
      hideWhenUnavailable = false,
      onSorted,
      text,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, handleSort, label, canSortRowColumn, Icon } =
      useTableSortRowColumn({
        editor,
        index,
        orientation,
        direction,
        hideWhenUnavailable,
        onSorted
      })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleSort()
      },
      [handleSort, onClick]
    )

    if (!isVisible) {
      return null
    }

    return (
      <Button
        type="button"
        disabled={!canSortRowColumn}
        data-style="ghost"
        data-active-state="off"
        data-disabled={!canSortRowColumn}
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

TableSortRowColumnButton.displayName = 'TableSortRowColumnButton'
