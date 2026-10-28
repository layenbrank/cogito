'use client'

import * as React from 'react'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

// --- Tiptap UI ---
import type { UseImageCaptionConfig } from '@/components/tiptap-ui/image-caption-button/use-image-caption.ts'
import { useImageCaption } from '@/components/tiptap-ui/image-caption-button/use-image-caption.ts'

// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button/button.tsx'
import { Button } from '@/components/tiptap-ui-primitive/button/button.tsx'

export interface ImageCaptionButtonProps
  extends Omit<ButtonProps, 'type'>, UseImageCaptionConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string
}

/**
 * Button component for toggling image captions in a Tiptap editor.
 * Only appears when an image is selected in the editor.
 *
 * For custom button implementations, use the `useImageCaption` hook instead.
 */
export const ImageCaptionButton = React.forwardRef<
  HTMLButtonElement,
  ImageCaptionButtonProps
>(
  (
    {
      editor: providedEditor,
      text,
      hideWhenUnavailable = false,
      onSet,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, isActive, canToggle, handleToggleCaption, label, Icon } =
      useImageCaption({
        editor,
        hideWhenUnavailable,
        onSet
      })

    const handleClick = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleToggleCaption()
      },
      [handleToggleCaption, onClick]
    )

    if (!isVisible) {
      return null
    }

    return (
      <Button
        type="button"
        data-style="ghost"
        data-active-state={isActive ? 'on' : 'off'}
        role="button"
        tabIndex={-1}
        disabled={!canToggle}
        data-disabled={!canToggle}
        aria-label={label}
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

ImageCaptionButton.displayName = 'ImageCaptionButton'
