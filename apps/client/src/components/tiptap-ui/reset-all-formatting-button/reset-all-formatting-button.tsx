import { forwardRef, useCallback } from "react"

// --- Lib ---
import { ShortcutBadge } from '@/components/tiptap-ui-primitive/badge/shortcut-badge.tsx'

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Tiptap UI ---
import type { UseResetAllFormattingConfig } from "@/components/tiptap-ui/reset-all-formatting-button/use-reset-all-formatting.ts"
import {
  RESET_ALL_FORMATTING_SHORTCUT_KEY,
  useResetAllFormatting,
} from "@/components/tiptap-ui/reset-all-formatting-button/use-reset-all-formatting.ts"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button/button.tsx"
import { Button } from "@/components/tiptap-ui-primitive/button/button.tsx"
import { t } from '@/views/knowledge/locale.ts'

export interface ResetAllFormattingButtonProps
  extends Omit<ButtonProps, "type">,
    UseResetAllFormattingConfig {
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

export function ResetAllFormattingShortcutBadge({
  shortcutKeys = RESET_ALL_FORMATTING_SHORTCUT_KEY,
}: {
  shortcutKeys?: string
}) {
  return <ShortcutBadge shortcutKeys={shortcutKeys} />
}

/**
 * Button component for resetting formatting of a node in a Tiptap editor.
 * Removes all marks and converts non-paragraph nodes to paragraphs.
 *
 * For custom button implementations, use the `useResetAllFormatting` hook instead.
 */
export const ResetAllFormattingButton = forwardRef<
  HTMLButtonElement,
  ResetAllFormattingButtonProps
>(
  (
    {
      editor: providedEditor,
      text,
      hideWhenUnavailable = false,
      preserveMarks = ["inlineThread"],
      onResetAllFormatting,
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
      canReset,
      handleResetFormatting,
      label,
      shortcutKeys,
      Icon,
    } = useResetAllFormatting({
      editor,
      preserveMarks,
      hideWhenUnavailable,
      onResetAllFormatting,
    })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleResetFormatting()
      },
      [handleResetFormatting, onClick]
    )

    if (!isVisible) {
      return null
    }

    return (
      <Button
        type="button"
        data-style="ghost"
        disabled={!canReset}
        data-disabled={!canReset}
        data-active-state="off"
        role="button"
        tabIndex={-1}
        aria-label={label}
        tooltip={t('EDITOR_RESET_FORMATTING')}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="size-3.5 shrink-0" />
            {text && <span className="truncate text-xs">{text}</span>}
            {showShortcut && (
              <ResetAllFormattingShortcutBadge shortcutKeys={shortcutKeys} />
            )}
          </>
        )}
      </Button>
    )
  }
)

ResetAllFormattingButton.displayName = "ResetAllFormattingButton"
