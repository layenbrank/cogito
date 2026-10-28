import { useCallback, useState } from 'react'
import { type Editor } from '@tiptap/react'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

// --- Icons ---
import { ChevronDownIcon } from '@/components/tiptap-icons/chevron-down-icon.tsx'

// --- Tiptap UI ---
import { ListButton } from '@/components/tiptap-ui/list-button/list-button.tsx'
import { type ListType } from '@/components/tiptap-ui/list-button/use-list.ts'

import { useListDropdownMenu } from '@/components/tiptap-ui/list-dropdown-menu/use-list-dropdown-menu'

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

export interface ListDropdownMenuProps extends Omit<ButtonProps, 'type'> {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor
  /**
   * The list types to display in the dropdown.
   */
  types?: ListType[]
  /**
   * Whether the dropdown should be hidden when no list types are available
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback for when the dropdown opens or closes
   */
  onOpenChange?: (isOpen: boolean) => void
  /**
   * Whether to render the dropdown menu in a portal
   * @default false
   */
  portal?: boolean
}

export function ListDropdownMenu({
  editor: providedEditor,
  types = ['bulletList', 'orderedList', 'taskList'],
  hideWhenUnavailable = false,
  onOpenChange,
  portal = false,
  ...props
}: ListDropdownMenuProps) {
  const { editor } = useTiptapEditor(providedEditor)
  const [isOpen, setIsOpen] = useState(false)

  const { filteredLists, canToggle, isActive, isVisible, Icon } =
    useListDropdownMenu({
      editor,
      types,
      hideWhenUnavailable
    })

  const handleOnOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open)
      onOpenChange?.(open)
    },
    [onOpenChange]
  )

  if (!isVisible) {
    return null
  }

  return (
    <DropdownMenu
      open={isOpen}
      onOpenChange={handleOnOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          data-style="ghost"
          data-active-state={isActive ? 'on' : 'off'}
          role="button"
          tabIndex={-1}
          disabled={!canToggle}
          data-disabled={!canToggle}
          aria-label={t('EDITOR_LIST_OPTIONS')}
          tooltip={t('EDITOR_LIST')}
          {...props}>
          <Icon className="size-3.5 shrink-0" />
          <ChevronDownIcon className="size-3 shrink-0 opacity-70" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        style={{
          zIndex: 1000
        }}
        align="start"
        portal={portal}>
        <Card>
          <CardBody>
            <ButtonGroup>
              {filteredLists.map((option) => (
                <DropdownMenuItem
                  key={option.type}
                  asChild>
                  <ListButton
                    editor={editor}
                    type={option.type}
                    text={option.label}
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

export default ListDropdownMenu
