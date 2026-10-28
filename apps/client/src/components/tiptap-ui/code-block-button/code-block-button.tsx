"use client"

import { forwardRef, useCallback } from "react"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Lib ---
import { ShortcutBadge } from '@/components/tiptap-ui-primitive/badge/shortcut-badge.tsx'

// --- Tiptap UI ---
import type { UseCodeBlockConfig } from "@/components/tiptap-ui/code-block-button/use-code-block.ts"
import {
  CODE_BLOCK_SHORTCUT_KEY,
  useCodeBlock,
} from "@/components/tiptap-ui/code-block-button/use-code-block.ts"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button/button.tsx"
import { Button } from "@/components/tiptap-ui-primitive/button/button.tsx"
import { t } from '@/views/knowledge/locale.ts'

export interface CodeBlockButtonProps
  extends Omit<ButtonProps, "type">,
    UseCodeBlockConfig {
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

export function CodeBlockShortcutBadge({
  shortcutKeys = CODE_BLOCK_SHORTCUT_KEY,
}: {
  shortcutKeys?: string
}) {
  return <ShortcutBadge shortcutKeys={shortcutKeys} />
}

/**
 * Button component for toggling code block in a Tiptap editor.
 *
 * For custom button implementations, use the `useCodeBlock` hook instead.
 */
export const CodeBlockButton = forwardRef<
  HTMLButtonElement,
  CodeBlockButtonProps
>(
  (
    {
      editor: providedEditor,
      text,
      hideWhenUnavailable = false,
      onToggled,
      showShortcut = false,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const {
      isVisible,
      canToggle,
      isActive,
      handleToggle,
      label,
      shortcutKeys,
      Icon,
    } = useCodeBlock({
      editor,
      hideWhenUnavailable,
      onToggled,
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
        data-style="ghost"
        data-active-state={isActive ? "on" : "off"}
        role="button"
        disabled={!canToggle}
        data-disabled={!canToggle}
        tabIndex={-1}
        aria-label={label}
        aria-pressed={isActive}
        tooltip={t('EDITOR_CODE_BLOCK')}
        shortcutKeys={shortcutKeys}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="size-3.5 shrink-0" />
            {text && <span className="truncate text-xs">{text}</span>}
            {showShortcut && (
              <CodeBlockShortcutBadge shortcutKeys={shortcutKeys} />
            )}
          </>
        )}
      </Button>
    )
  }
)

CodeBlockButton.displayName = "CodeBlockButton"
