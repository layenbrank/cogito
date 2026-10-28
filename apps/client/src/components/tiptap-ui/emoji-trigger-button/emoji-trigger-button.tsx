"use client"

import { forwardRef, useCallback } from "react"

// --- Lib ---
import { ShortcutBadge } from '@/components/tiptap-ui-primitive/badge/shortcut-badge.tsx'

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor.ts"

// --- Tiptap UI ---
import type { UseEmojiTriggerConfig } from "@/components/tiptap-ui/emoji-trigger-button/use-emoji-trigger.ts"
import {
  EMOJI_TRIGGER_SHORTCUT_KEY,
  useEmojiTrigger,
} from "@/components/tiptap-ui/emoji-trigger-button/use-emoji-trigger.ts"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button/button.tsx"
import { Button } from "@/components/tiptap-ui-primitive/button/button.tsx"
import { t } from '@/views/knowledge/locale.ts'

export interface EmojiTriggerButtonProps
  extends Omit<ButtonProps, "type">,
    UseEmojiTriggerConfig {
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

export function EmojiTriggerShortcutBadge({
  shortcutKeys = EMOJI_TRIGGER_SHORTCUT_KEY,
}: {
  shortcutKeys?: string
}) {
  return <ShortcutBadge shortcutKeys={shortcutKeys} />
}

/**
 * Button component for adding emoji trigger in a Tiptap editor.
 *
 * For custom button implementations, use the `useEmojiTrigger` hook instead.
 */
export const EmojiTriggerButton = forwardRef<
  HTMLButtonElement,
  EmojiTriggerButtonProps
>(
  (
    {
      editor: providedEditor,
      node,
      nodePos,
      text,
      trigger = ":",
      hideWhenUnavailable = false,
      onTriggerApplied,
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
      canAddTrigger,
      handleAddTrigger,
      label,
      shortcutKeys,
      Icon,
    } = useEmojiTrigger({
      editor,
      node,
      nodePos,
      trigger,
      hideWhenUnavailable,
      onTriggerApplied,
    })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleAddTrigger()
      },
      [handleAddTrigger, onClick]
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
        disabled={!canAddTrigger}
        data-disabled={!canAddTrigger}
        aria-label={label}
        tooltip={t('EDITOR_ADD_EMOJI')}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="size-3.5 shrink-0" />
            {text && <span className="truncate text-xs">{text}</span>}
            {showShortcut && (
              <EmojiTriggerShortcutBadge shortcutKeys={shortcutKeys} />
            )}
          </>
        )}
      </Button>
    )
  }
)

EmojiTriggerButton.displayName = "EmojiTriggerButton"
