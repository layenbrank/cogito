"use client"

import { forwardRef, useCallback } from "react"

// --- Lib ---
import { ShortcutBadge } from '@/components/tiptap-ui-primitive/badge/shortcut-badge.tsx'

// --- Tiptap UI ---
import type {
  Level,
  UseHeadingConfig,
} from "@/components/tiptap-ui/heading-button/use-heading.ts"
import {
  HEADING_SHORTCUT_KEYS,
  useHeading,
} from "@/components/tiptap-ui/heading-button/use-heading.ts"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button/button.tsx"
import { Button } from "@/components/tiptap-ui-primitive/button/button.tsx"
import { useTiptapEditor } from "@/hooks/use-tiptap-editor.ts"

export interface HeadingButtonProps
  extends Omit<ButtonProps, "type">,
    UseHeadingConfig {
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

export function HeadingShortcutBadge({
  level,
  shortcutKeys = HEADING_SHORTCUT_KEYS[level],
}: {
  level: Level
  shortcutKeys?: string
}) {
  return <ShortcutBadge shortcutKeys={shortcutKeys} />
}

/**
 * Button component for toggling heading in a Tiptap editor.
 *
 * For custom button implementations, use the `useHeading` hook instead.
 */
export const HeadingButton = forwardRef<HTMLButtonElement, HeadingButtonProps>(
  (
    {
      editor: providedEditor,
      level,
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
      Icon,
      shortcutKeys,
    } = useHeading({
      editor,
      level,
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
        tabIndex={-1}
        disabled={!canToggle}
        data-disabled={!canToggle}
        aria-label={label}
        aria-pressed={isActive}
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
              <HeadingShortcutBadge level={level} shortcutKeys={shortcutKeys} />
            )}
          </>
        )}
      </Button>
    )
  }
)

HeadingButton.displayName = "HeadingButton"
