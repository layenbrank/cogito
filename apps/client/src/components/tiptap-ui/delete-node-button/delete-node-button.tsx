"use client"

import { forwardRef, useCallback } from "react"

// --- Lib ---
import { ShortcutBadge } from '@/components/tiptap-ui-primitive/badge/shortcut-badge.tsx'

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor.ts"

// --- Tiptap UI ---
import type { UseDeleteNodeConfig } from "@/components/tiptap-ui/delete-node-button/use-delete-node.ts"
import {
  DELETE_NODE_SHORTCUT_KEY,
  useDeleteNode,
} from "@/components/tiptap-ui/delete-node-button/use-delete-node.ts"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button/button.tsx"
import { Button } from "@/components/tiptap-ui-primitive/button/button.tsx"
import { t } from '@/views/knowledge/locale.ts'

export interface DeleteNodeButtonProps
  extends Omit<ButtonProps, "type">,
    UseDeleteNodeConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string
  /**
   * Optional show shortcut keys in the button.
   * @default false
   */
  showShortcut?: boolean
}

export function DeleteNodeShortcutBadge({
  shortcutKeys = DELETE_NODE_SHORTCUT_KEY,
}: {
  shortcutKeys?: string
}) {
  return <ShortcutBadge shortcutKeys={shortcutKeys} />
}

/**
 * Button component for deleting a node in a Tiptap editor.
 *
 * For custom button implementations, use the `useDeleteNode` hook instead.
 */
export const DeleteNodeButton = forwardRef<
  HTMLButtonElement,
  DeleteNodeButtonProps
>(
  (
    {
      editor: providedEditor,
      text,
      hideWhenUnavailable = false,
      onDeleted,
      showShortcut = false,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, handleDeleteNode, label, shortcutKeys, Icon } =
      useDeleteNode({
        editor,
        hideWhenUnavailable,
        onDeleted,
      })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleDeleteNode()
      },
      [handleDeleteNode, onClick]
    )

    if (!isVisible) {
      return null
    }

    return (
      <Button
        type="button"
        data-style="ghost"
        role="button"
        tabIndex={-1}
        aria-label={label}
        tooltip={t('DELETE')}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="size-3.5 shrink-0" />
            {text && <span className="truncate text-xs">{text}</span>}
            {showShortcut && (
              <DeleteNodeShortcutBadge shortcutKeys={shortcutKeys} />
            )}
          </>
        )}
      </Button>
    )
  }
)

DeleteNodeButton.displayName = "DeleteNodeButton"
