// @ts-nocheck
'use client'

import { forwardRef, useCallback } from 'react'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor'

// --- Tiptap UI ---
import type { UseTableAlignCellConfig } from '@/components/tiptap-node/table-node/ui/table-align-cell-button/use-table-align-cell.ts'
import { useTableAlignCell } from '@/components/tiptap-node/table-node/ui/table-align-cell-button/use-table-align-cell.ts'

// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button/button.tsx'
import { Button } from '@/components/tiptap-ui-primitive/button/button.tsx'

export interface TableAlignCellButtonProps
  extends Omit<ButtonProps, 'type'>, UseTableAlignCellConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string
}

/**
 * Button component for aligning table cells in a Tiptap editor.
 * Supports both text alignment (left, center, right, justify) and
 * vertical alignment (top, middle, bottom).
 *
 * Can align either the currently selected cell(s) or all cells in a specific row/column.
 *
 * @example
 * ```tsx
 * // Align the currently selected cell(s)
 * <TableAlignCellButton
 *   alignmentType="text"
 *   alignment="center"
 * />
 *
 * // Align all cells in row 0
 * <TableAlignCellButton
 *   alignmentType="text"
 *   alignment="center"
 *   index={0}
 *   orientation="row"
 * />
 *
 * // Align all cells in column 2
 * <TableAlignCellButton
 *   alignmentType="vertical"
 *   alignment="middle"
 *   index={2}
 *   orientation="column"
 * />
 * ```
 */
export const TableAlignCellButton = forwardRef<
  HTMLButtonElement,
  TableAlignCellButtonProps
>(
  (
    {
      editor: providedEditor,
      alignmentType,
      alignment,
      index,
      orientation,
      hideWhenUnavailable = false,
      onAligned,
      text,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, handleAlign, label, canAlignCell, Icon, isActive } =
      useTableAlignCell({
        editor,
        alignmentType,
        alignment,
        index,
        orientation,
        hideWhenUnavailable,
        onAligned
      })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleAlign()
      },
      [handleAlign, onClick]
    )

    if (!isVisible) {
      return null
    }

    return (
      <Button
        type="button"
        disabled={!canAlignCell}
        data-style="ghost"
        data-active-state={isActive ? 'on' : 'off'}
        data-disabled={!canAlignCell}
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

TableAlignCellButton.displayName = 'TableAlignCellButton'
