import { forwardRef, useCallback } from 'react'

// --- Lib ---
import { ShortcutBadge } from '@/components/tiptap-ui-primitive/badge/shortcut-badge.tsx'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

// --- Tiptap UI ---
import type { UseCopyAnchorLinkConfig } from '@/components/tiptap-ui/copy-anchor-link-button/use-copy-anchor-link.ts'
import {
  COPY_ANCHOR_LINK_SHORTCUT_KEY,
  useCopyAnchorLink
} from '@/components/tiptap-ui/copy-anchor-link-button/use-copy-anchor-link.ts'

// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button/button.tsx'
import { Button } from '@/components/tiptap-ui-primitive/button/button.tsx'
import { t } from '@/views/knowledge/locale.ts'

export interface CopyAnchorLinkButtonProps
  extends Omit<ButtonProps, 'type'>, UseCopyAnchorLinkConfig {
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

export function CopyAnchorLinkShortcutBadge({
  shortcutKeys = COPY_ANCHOR_LINK_SHORTCUT_KEY
}: {
  shortcutKeys?: string
}) {
  return <ShortcutBadge shortcutKeys={shortcutKeys} />
}

/**
 * Button component for copying anchor links in a Tiptap editor.
 *
 * For custom button implementations, use the `useCopyAnchorLink` hook instead.
 */
export const CopyAnchorLinkButton = forwardRef<
  HTMLButtonElement,
  CopyAnchorLinkButtonProps
>(
  (
    {
      editor: providedEditor,
      text,
      hideWhenUnavailable = false,
      onNodeIdNotFound,
      onExtractedNodeId,
      onCopied,
      showShortcut = false,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, handleCopyAnchorLink, label, shortcutKeys, Icon } =
      useCopyAnchorLink({
        editor,
        hideWhenUnavailable,
        onNodeIdNotFound,
        onExtractedNodeId,
        onCopied
      })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        void handleCopyAnchorLink()
      },
      [handleCopyAnchorLink, onClick]
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
        tooltip={t('EDITOR_COPY_ANCHOR')}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}>
        {children ?? (
          <>
            <Icon className="size-3.5 shrink-0" />
            {text && <span className="truncate text-xs">{text}</span>}
            {showShortcut && (
              <CopyAnchorLinkShortcutBadge shortcutKeys={shortcutKeys} />
            )}
          </>
        )}
      </Button>
    )
  }
)

CopyAnchorLinkButton.displayName = 'CopyAnchorLinkButton'
