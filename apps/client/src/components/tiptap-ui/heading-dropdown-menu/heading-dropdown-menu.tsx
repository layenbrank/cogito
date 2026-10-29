'use client'

import { forwardRef, useCallback, useState } from 'react'

// --- Icons ---
import { ChevronDownIcon } from '@/components/tiptap-icons/chevron-down-icon.tsx'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

// --- Tiptap UI ---
import { HeadingButton } from '@/components/tiptap-ui/heading-button/heading-button.tsx'
import type { UseHeadingDropdownMenuConfig } from '@/components/tiptap-ui/heading-dropdown-menu/use-heading-dropdown-menu.ts'
import { useHeadingDropdownMenu } from '@/components/tiptap-ui/heading-dropdown-menu/use-heading-dropdown-menu.ts'

// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button/button.tsx'
import {
  Button,
  ButtonGroup
} from '@/components/tiptap-ui-primitive/button/button.tsx'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from '@/components/tiptap-ui-primitive/dropdown-menu/dropdown-menu.tsx'
import { Card, CardBody } from '@/components/tiptap-ui-primitive/card/card.tsx'
import { t } from '@/views/knowledge/locale.ts'

export interface HeadingDropdownMenuProps
  extends Omit<ButtonProps, 'type'>, UseHeadingDropdownMenuConfig {
  /**
   * Whether to render the dropdown menu in a portal
   * @default false
   */
  portal?: boolean
  /**
   * Callback for when the dropdown opens or closes
   */
  onOpenChange?: (isOpen: boolean) => void
}

const HEADING_LEVELS: UseHeadingDropdownMenuConfig['levels'] = [1, 2, 3, 4, 5, 6]

/**
 * Dropdown menu component for selecting heading levels in a Tiptap editor.
 *
 * For custom dropdown implementations, use the `useHeadingDropdownMenu` hook instead.
 */
export const HeadingDropdownMenu = forwardRef<
  HTMLButtonElement,
  HeadingDropdownMenuProps
>(
  (
    {
      editor: providedEditor,
      levels = HEADING_LEVELS,
      hideWhenUnavailable = false,
      portal = false,
      onOpenChange,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const [isOpen, setIsOpen] = useState<boolean>(false)
    const { isVisible, isActive, canToggle, Icon } = useHeadingDropdownMenu({
      editor,
      levels,
      hideWhenUnavailable
    })

    const handleOpenChange = useCallback(
      (open: boolean) => {
        if (open && (!editor || !canToggle)) return
        setIsOpen(open)
        onOpenChange?.(open)
      },
      [canToggle, editor, onOpenChange]
    )

    if (!isVisible) {
      return null
    }

    return (
      <DropdownMenu
        open={isOpen}
        onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            data-style="ghost"
            data-active-state={isActive ? 'on' : 'off'}
            role="button"
            tabIndex={-1}
            disabled={!canToggle}
            data-disabled={!canToggle}
            aria-label={t('EDITOR_HEADING_OPTIONS')}
            aria-pressed={isActive}
            tooltip={t('EDITOR_HEADING')}
            {...buttonProps}
            ref={ref}>
            <Icon className="size-3.5 shrink-0" />
            <ChevronDownIcon className="size-3 shrink-0 opacity-70" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          portal={portal}>
          <Card>
            <CardBody>
              <ButtonGroup>
                {levels.map((level) => (
                  <DropdownMenuItem
                    key={`heading-${level}`}
                    asChild>
                    <HeadingButton
                      editor={editor}
                      level={level}
                      text={`Heading ${level}`}
                      showTooltip={false}
                    />
                  </DropdownMenuItem>
                ))}
              </ButtonGroup>
            </CardBody>
          </Card>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
)

HeadingDropdownMenu.displayName = 'HeadingDropdownMenu'

export default HeadingDropdownMenu
