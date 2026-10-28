// @ts-nocheck
'use client'

import { forwardRef, useCallback } from 'react'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

// --- Tiptap UI ---
import type { UseTableClearRowColumnContentConfig } from '@/components/tiptap-node/table-node/ui/table-clear-row-column-content-button/use-table-clear-row-column-content.ts'
import { useTableClearRowColumnContent } from '@/components/tiptap-node/table-node/ui/table-clear-row-column-content-button/use-table-clear-row-column-content.ts'

// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button/button.tsx'
import { Button } from '@/components/tiptap-ui-primitive/button/button.tsx'

export interface TableClearRowColumnContentButtonProps
  extends Omit<ButtonProps, 'type'>, UseTableClearRowColumnContentConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string
}

/**
 * Button component for clearing table row/column content in a Tiptap editor.
 *
 * For custom button implementations, use the `useTableClearRowColumnContent` hook instead.
 */
export const TableClearRowColumnContentButton = forwardRef<
  HTMLButtonElement,
  TableClearRowColumnContentButtonProps
>(
  (
    {
      editor: providedEditor,
      index,
      orientation,
      hideWhenUnavailable = false,
      resetAttrs = false,
      onCleared,
      text,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, handleClear, label, canClearRowColumnContent, Icon } =
      useTableClearRowColumnContent({
        editor,
        index,
        orientation,
        hideWhenUnavailable,
        resetAttrs,
        onCleared
      })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleClear()
      },
      [handleClear, onClick]
    )

    if (!isVisible) {
      return null
    }

    return (
      <Button
        type="button"
        disabled={!canClearRowColumnContent}
        data-style="ghost"
        data-active-state="off"
        data-disabled={!canClearRowColumnContent}
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

TableClearRowColumnContentButton.displayName =
  'TableClearRowColumnContentButton'
