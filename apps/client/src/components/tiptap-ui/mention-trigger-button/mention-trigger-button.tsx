"use client"

import { forwardRef, useCallback } from "react"

// --- Lib ---
import { ShortcutBadge } from '@/components/tiptap-ui-primitive/badge/shortcut-badge.tsx'

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor.ts"

// --- Tiptap UI ---
import type { UseMentionTriggerConfig } from "@/components/tiptap-ui/mention-trigger-button/use-mention-trigger.ts"
import {
  MENTION_TRIGGER_SHORTCUT_KEY,
  useMentionTrigger,
} from "@/components/tiptap-ui/mention-trigger-button/use-mention-trigger.ts"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button/button.tsx"
import { Button } from "@/components/tiptap-ui-primitive/button/button.tsx"

export interface MentionTriggerButtonProps
  extends Omit<ButtonProps, "type">,
    UseMentionTriggerConfig {
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

export function MentionShortcutBadge({
  shortcutKeys = MENTION_TRIGGER_SHORTCUT_KEY,
}: {
  shortcutKeys?: string
}) {
  return <ShortcutBadge shortcutKeys={shortcutKeys} />
}

/**
 * Button component for inserting mention triggers in a Tiptap editor.
 *
 * For custom button implementations, use the `useMention` hook instead.
 */
export const MentionTriggerButton = forwardRef<
  HTMLButtonElement,
  MentionTriggerButtonProps
>(
  (
    {
      editor: providedEditor,
      node,
      nodePos,
      text,
      trigger = "@",
      hideWhenUnavailable = false,
      onTriggered,
      showShortcut = false,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, canInsert, handleMention, label, shortcutKeys, Icon } =
      useMentionTrigger({
        editor,
        node,
        nodePos,
        trigger,
        hideWhenUnavailable,
        onTriggered,
      })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleMention()
      },
      [handleMention, onClick]
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
        disabled={!canInsert}
        data-disabled={!canInsert}
        aria-label={label}
        tooltip={label}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="size-3.5 shrink-0" />
            {text && <span className="truncate text-xs">{text}</span>}
            {showShortcut && (
              <MentionShortcutBadge shortcutKeys={shortcutKeys} />
            )}
          </>
        )}
      </Button>
    )
  }
)

MentionTriggerButton.displayName = "MentionTriggerButton"
