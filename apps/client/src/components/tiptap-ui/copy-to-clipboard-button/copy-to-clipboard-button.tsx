import { forwardRef, useCallback } from "react"

// --- Lib ---
import { ShortcutBadge } from '@/components/tiptap-ui-primitive/badge/shortcut-badge.tsx'

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor.ts"

// --- Tiptap UI ---
import type { UseCopyToClipboardConfig } from "@/components/tiptap-ui/copy-to-clipboard-button/use-copy-to-clipboard.ts"
import {
  COPY_TO_CLIPBOARD_SHORTCUT_KEY,
  useCopyToClipboard,
} from "@/components/tiptap-ui/copy-to-clipboard-button/use-copy-to-clipboard.ts"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button/button.tsx"
import { Button } from "@/components/tiptap-ui-primitive/button/button.tsx"
import { t } from '@/views/knowledge/locale.ts'

export interface CopyToClipboardButtonProps
  extends Omit<ButtonProps, "type">,
    UseCopyToClipboardConfig {
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

export function CopyToClipboardShortcutBadge({
  shortcutKeys = COPY_TO_CLIPBOARD_SHORTCUT_KEY,
}: {
  shortcutKeys?: string
}) {
  return <ShortcutBadge shortcutKeys={shortcutKeys} />
}

/**
 * Button component for copying content to clipboard in a Tiptap editor.
 *
 * For custom button implementations, use the `useCopyToClipboard` hook instead.
 */
export const CopyToClipboardButton = forwardRef<
  HTMLButtonElement,
  CopyToClipboardButtonProps
>(
  (
    {
      editor: providedEditor,
      text,
      copyWithFormatting = true,
      hideWhenUnavailable = false,
      onCopied,
      showShortcut = false,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, handleCopyToClipboard, label, shortcutKeys, Icon } =
      useCopyToClipboard({
        editor,
        copyWithFormatting,
        hideWhenUnavailable,
        onCopied,
      })

    const handleClick = useCallback(
      async (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        await handleCopyToClipboard()
      },
      [handleCopyToClipboard, onClick]
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
        tooltip={t('EDITOR_COPY_CLIPBOARD')}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="size-3.5 shrink-0" />
            {text && <span className="truncate text-xs">{text}</span>}
            {showShortcut && (
              <CopyToClipboardShortcutBadge shortcutKeys={shortcutKeys} />
            )}
          </>
        )}
      </Button>
    )
  }
)

CopyToClipboardButton.displayName = "CopyToClipboardButton"
