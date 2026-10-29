'use client'

import { forwardRef } from 'react'
import type { Editor } from '@tiptap/react'

// --- Tiptap UI ---
import type { UseTurnIntoDropdownConfig } from '@/components/tiptap-ui/turn-into-dropdown/use-turn-into-dropdown.ts'
import {
  useTurnIntoDropdown,
  findFilteredBlockTypeOptions
} from '@/components/tiptap-ui/turn-into-dropdown/use-turn-into-dropdown.ts'
import { useText } from '@/components/tiptap-ui/text-button/use-text.ts'
import {
  useHeading,
  type Level
} from '@/components/tiptap-ui/heading-button/use-heading.ts'
import { useList } from '@/components/tiptap-ui/list-button/use-list.ts'
import type { ListType } from '@/components/tiptap-ui/list-button/use-list.ts'
import { useBlockquote } from '@/components/tiptap-ui/blockquote-button/use-blockquote.ts'
import { useCodeBlock } from '@/components/tiptap-ui/code-block-button/use-code-block.ts'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

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
import {
  Card,
  CardBody,
  CardGroupLabel,
  CardItemGroup
} from '@/components/tiptap-ui-primitive/card/card.tsx'
import { t } from '@/views/knowledge/locale.ts'

export interface TurnIntoDropdownContentProps {
  editor?: Editor | null
  blockTypes?: string[]
  useCardLayout?: boolean
}

interface BlockMenuItemProps {
  editor?: Editor | null
  label: string
}

/**
 * 不用 asChild+Button：Menu.Item 保持默认 div，避免 Base UI nativeButton 与内层 button 元素冲突。
 */
function ParagraphMenuItem({ editor, label }: BlockMenuItemProps) {
  const { handleToggle, canToggle, isActive, Icon } = useText({ editor })
  return (
    <DropdownMenuItem
      disabled={!canToggle}
      onClick={function () {
        handleToggle()
      }}
      data-active-state={isActive ? 'on' : 'off'}>
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate text-xs">{label}</span>
    </DropdownMenuItem>
  )
}

function HeadingMenuItem({
  editor,
  label,
  level
}: BlockMenuItemProps & { level: Level }) {
  const { handleToggle, canToggle, isActive, Icon } = useHeading({
    editor,
    level
  })
  return (
    <DropdownMenuItem
      disabled={!canToggle}
      onClick={function () {
        handleToggle()
      }}
      data-active-state={isActive ? 'on' : 'off'}>
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate text-xs">{label}</span>
    </DropdownMenuItem>
  )
}

function ListMenuItem({
  editor,
  label,
  type
}: BlockMenuItemProps & { type: ListType }) {
  const { handleToggle, canToggle, isActive, Icon } = useList({ editor, type })
  return (
    <DropdownMenuItem
      disabled={!canToggle}
      onClick={function () {
        handleToggle()
      }}
      data-active-state={isActive ? 'on' : 'off'}>
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate text-xs">{label}</span>
    </DropdownMenuItem>
  )
}

function BlockquoteMenuItem({ editor, label }: BlockMenuItemProps) {
  const { handleToggle, canToggle, isActive, Icon } = useBlockquote({ editor })
  return (
    <DropdownMenuItem
      disabled={!canToggle}
      onClick={function () {
        handleToggle()
      }}
      data-active-state={isActive ? 'on' : 'off'}>
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate text-xs">{label}</span>
    </DropdownMenuItem>
  )
}

function CodeBlockMenuItem({ editor, label }: BlockMenuItemProps) {
  const { handleToggle, canToggle, isActive, Icon } = useCodeBlock({ editor })
  return (
    <DropdownMenuItem
      disabled={!canToggle}
      onClick={function () {
        handleToggle()
      }}
      data-active-state={isActive ? 'on' : 'off'}>
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate text-xs">{label}</span>
    </DropdownMenuItem>
  )
}

function renderBlockTypeButton(
  option: ReturnType<typeof findFilteredBlockTypeOptions>[0],
  key: string,
  editor?: Editor | null
) {
  switch (option.type) {
    case 'paragraph':
      return (
        <ParagraphMenuItem
          key={key}
          editor={editor}
          label={option.label}
        />
      )

    case 'heading':
      if (!option.level) {
        return null
      }
      return (
        <HeadingMenuItem
          key={key}
          editor={editor}
          label={option.label}
          level={option.level}
        />
      )

    case 'bulletList':
      return (
        <ListMenuItem
          key={key}
          editor={editor}
          label={option.label}
          type="bulletList"
        />
      )

    case 'orderedList':
      return (
        <ListMenuItem
          key={key}
          editor={editor}
          label={option.label}
          type="orderedList"
        />
      )

    case 'taskList':
      return (
        <ListMenuItem
          key={key}
          editor={editor}
          label={option.label}
          type="taskList"
        />
      )

    case 'blockquote':
      return (
        <BlockquoteMenuItem
          key={key}
          editor={editor}
          label={option.label}
        />
      )

    case 'codeBlock':
      return (
        <CodeBlockMenuItem
          key={key}
          editor={editor}
          label={option.label}
        />
      )

    default:
      return null
  }
}

export const TurnIntoDropdownContent: React.FC<
  TurnIntoDropdownContentProps
> = ({ editor, blockTypes, useCardLayout = true }) => {
  const filteredOptions = findFilteredBlockTypeOptions(blockTypes)

  const renderButtons = () => (
    <ButtonGroup>
      {filteredOptions.map((option, index) =>
        renderBlockTypeButton(
          option,
          `${option.type}-${option.level ?? index}`,
          editor
        )
      )}
    </ButtonGroup>
  )

  if (!useCardLayout) return renderButtons()

  return (
    <Card>
      <CardBody>
        <CardItemGroup>
          <CardGroupLabel>{t('EDITOR_TURN_INTO')}</CardGroupLabel>
          {renderButtons()}
        </CardItemGroup>
      </CardBody>
    </Card>
  )
}

export interface TurnIntoDropdownProps
  extends Omit<ButtonProps, 'type'>, UseTurnIntoDropdownConfig {
  /**
   * Whether to use card layout for the dropdown content
   * @default true
   */
  useCardLayout?: boolean
  portal?: boolean
}

/**
 * Dropdown component for transforming block types in a Tiptap editor.
 * For custom dropdown implementations, use the `useTurnIntoDropdown` hook instead.
 */
export const TurnIntoDropdown = forwardRef<
  HTMLButtonElement,
  TurnIntoDropdownProps
>(
  (
    {
      editor: providedEditor,
      hideWhenUnavailable = false,
      blockTypes,
      portal,
      useCardLayout = true,
      onOpenChange,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const {
      isVisible,
      canToggle,
      isOpen,
      activeBlockType,
      handleOpenChange,
      label,
      Icon
    } = useTurnIntoDropdown({
      editor,
      hideWhenUnavailable,
      blockTypes,
      onOpenChange
    })

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
            disabled={!canToggle}
            data-disabled={!canToggle}
            role="button"
            tabIndex={-1}
            aria-label={label}
            tooltip={t('EDITOR_TURN_INTO')}
            {...buttonProps}
            ref={ref}>
            {children ?? (
              <>
                <span className="truncate text-xs">
                  {activeBlockType?.label || t('EDITOR_TEXT')}
                </span>
                <Icon className="size-3 shrink-0 opacity-70" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          portal={portal}
          style={{
            zIndex: 1000
          }}
          align="start">
          <TurnIntoDropdownContent
            editor={editor}
            blockTypes={blockTypes}
            useCardLayout={useCardLayout}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
)

TurnIntoDropdown.displayName = 'TurnIntoDropdown'
