// @ts-nocheck
import { forwardRef, useCallback } from 'react'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

// --- Tiptap UI ---
import type { UseTableHeaderRowColumnConfig } from '@/components/tiptap-node/table-node/ui/table-header-row-column-button/use-table-header-row-column.ts'
import { useTableHeaderRowColumn } from '@/components/tiptap-node/table-node/ui/table-header-row-column-button/use-table-header-row-column.ts'

// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button/button.tsx'
import { Button } from '@/components/tiptap-ui-primitive/button/button.tsx'

export interface TableHeaderRowColumnButtonProps
  extends Omit<ButtonProps, 'type'>, UseTableHeaderRowColumnConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string
}

/**
 * Button component for toggling table header row/column in a Tiptap editor.
 * Only works for the first row (index 0) or first column (index 0).
 *
 * For custom button implementations, use the `useTableHeaderRowColumn` hook instead.
 */
export const TableHeaderRowColumnButton = forwardRef<
  HTMLButtonElement,
  TableHeaderRowColumnButtonProps
>(
  (
    {
      editor: providedEditor,
      index,
      orientation,
      hideWhenUnavailable = false,
      onToggled,
      text,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, handleToggle, label, canToggleHeader, Icon, isActive } =
      useTableHeaderRowColumn({
        editor,
        index,
        orientation,
        hideWhenUnavailable,
        onToggled
      })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleToggle()
      },
      [handleToggle, onClick]
    )

    if (!isVisible) {
      return null
    }

    return (
      <Button
        type="button"
        disabled={!canToggleHeader}
        data-style="ghost"
        data-active-state={isActive ? 'on' : 'off'}
        data-disabled={!canToggleHeader}
        role="button"
        tabIndex={-1}
        aria-label={label}
        aria-pressed={isActive}
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

TableHeaderRowColumnButton.displayName = 'TableHeaderRowColumnButton'
