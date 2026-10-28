import { forwardRef, useCallback, useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'

// --- Hooks ---
import { useIsBreakpoint } from '@/hooks/use-is-breakpoint.ts'
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

// --- Icons ---
import { CornerDownLeftIcon } from '@/components/tiptap-icons/corner-down-left-icon.tsx'
import { ExternalLinkIcon } from '@/components/tiptap-icons/external-link-icon.tsx'
import { LinkIcon } from '@/components/tiptap-icons/link-icon.tsx'
import { TrashIcon } from '@/components/tiptap-icons/trash-icon.tsx'

// --- Tiptap UI ---
import type { UseLinkPopoverConfig } from '@/components/tiptap-ui/link-popover/use-link-popover.ts'
import { useLinkPopover } from '@/components/tiptap-ui/link-popover/use-link-popover.ts'

// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button/button.tsx'
import {
  Button,
  ButtonGroup
} from '@/components/tiptap-ui-primitive/button/button.tsx'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/tiptap-ui-primitive/popover/popover.tsx'
import { Separator } from '@/components/tiptap-ui-primitive/separator/separator.tsx'
import {
  Card,
  CardBody,
  CardItemGroup
} from '@/components/tiptap-ui-primitive/card/card.tsx'
import {
  Input,
  InputGroup
} from '@/components/tiptap-ui-primitive/input/input.tsx'
import { t } from '@/views/knowledge/locale.ts'

export interface LinkMainProps {
  /**
   * The URL to set for the link.
   */
  url: string
  /**
   * Function to update the URL state.
   */
  setUrl: React.Dispatch<React.SetStateAction<string | null>>
  /**
   * Function to set the link in the editor.
   */
  setLink: () => void
  /**
   * Function to remove the link from the editor.
   */
  removeLink: () => void
  /**
   * Function to open the link.
   */
  openLink: () => void
  /**
   * Whether the link is currently active in the editor.
   */
  isActive: boolean
}

export interface LinkPopoverProps
  extends Omit<ButtonProps, 'type'>, UseLinkPopoverConfig {
  /**
   * Callback for when the popover opens or closes.
   */
  onOpenChange?: (isOpen: boolean) => void
  /**
   * Whether to automatically open the popover when a link is active.
   * 默认关闭：工具栏与气泡菜单各有一份时，打开文档光标落在链接上
   * 会同时弹出两个 URL 输入框（且气泡未定位时会落到左上角）。
   * @default false
   */
  autoOpenOnLinkActive?: boolean
  /**
   * BubbleMenu 内须为 false，避免 portal 到 body 导致气泡闪退。
   * @default true
   */
  portal?: boolean
}

/**
 * Link button component for triggering the link popover
 */
export const LinkButton = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <Button
        type="button"
        className={className}
        data-style="ghost"
        role="button"
        tabIndex={-1}
        aria-label={t('EDITOR_LINK')}
        tooltip={t('EDITOR_LINK')}
        ref={ref}
        {...props}>
        {children || <LinkIcon className="size-3.5 shrink-0" />}
      </Button>
    )
  }
)

LinkButton.displayName = 'LinkButton'

/**
 * Main content component for the link popover
 */
const LinkMain: React.FC<LinkMainProps> = ({
  url,
  setUrl,
  setLink,
  removeLink,
  openLink,
  isActive
}) => {
  const isMobile = useIsBreakpoint()

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      setLink()
    }
  }

  return (
    <Card
      style={{
        ...(isMobile ? { boxShadow: 'none', border: 0 } : {})
      }}>
      <CardBody
        style={{
          ...(isMobile ? { padding: 0 } : {})
        }}>
        <CardItemGroup orientation="horizontal">
          <InputGroup>
            <Input
              type="url"
              placeholder={t('EDITOR_LINK_PLACEHOLDER')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
          </InputGroup>

          <ButtonGroup orientation="horizontal">
            <Button
              type="button"
              onClick={setLink}
              title={t('EDITOR_LINK_APPLY')}
              disabled={!url && !isActive}
              data-style="ghost">
              <CornerDownLeftIcon className="size-3.5 shrink-0" />
            </Button>
          </ButtonGroup>

          <Separator />

          <ButtonGroup orientation="horizontal">
            <Button
              type="button"
              onClick={openLink}
              title={t('EDITOR_LINK_OPEN')}
              disabled={!url && !isActive}
              data-style="ghost">
              <ExternalLinkIcon className="size-3.5 shrink-0" />
            </Button>

            <Button
              type="button"
              onClick={removeLink}
              title={t('EDITOR_LINK_REMOVE')}
              disabled={!url && !isActive}
              data-style="ghost">
              <TrashIcon className="size-3.5 shrink-0" />
            </Button>
          </ButtonGroup>
        </CardItemGroup>
      </CardBody>
    </Card>
  )
}

/**
 * Link content component for standalone use
 */
export const LinkContent: React.FC<{
  editor?: Editor | null
}> = ({ editor }) => {
  const linkPopover = useLinkPopover({
    editor
  })

  return <LinkMain {...linkPopover} />
}

/**
 * Link popover component for Tiptap editors.
 *
 * For custom popover implementations, use the `useLinkPopover` hook instead.
 */
export const LinkPopover = forwardRef<HTMLButtonElement, LinkPopoverProps>(
  (
    {
      editor: providedEditor,
      hideWhenUnavailable = false,
      onSetLink,
      onOpenChange,
      autoOpenOnLinkActive = false,
      portal = true,
      onClick,
      children,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const [isOpen, setIsOpen] = useState(false)

    const {
      isVisible,
      canSet,
      isActive,
      url,
      setUrl,
      setLink,
      removeLink,
      openLink,
      label,
      Icon
    } = useLinkPopover({
      editor,
      hideWhenUnavailable,
      onSetLink
    })

    const handleOnOpenChange = useCallback(
      (nextIsOpen: boolean) => {
        setIsOpen(nextIsOpen)
        onOpenChange?.(nextIsOpen)
      },
      [onOpenChange]
    )

    const handleSetLink = useCallback(() => {
      setLink()
      setIsOpen(false)
    }, [setLink])

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        setIsOpen(!isOpen)
      },
      [onClick, isOpen]
    )

    useEffect(() => {
      if (!autoOpenOnLinkActive) return
      if (isActive) {
        requestAnimationFrame(function () {
          setIsOpen(true)
        })
        return
      }
      setIsOpen(false)
    }, [autoOpenOnLinkActive, isActive])

    if (!isVisible) {
      return null
    }

    return (
      <Popover
        open={isOpen}
        onOpenChange={handleOnOpenChange}>
        <PopoverTrigger asChild>
          <LinkButton
            disabled={!canSet}
            data-active-state={isActive ? 'on' : 'off'}
            data-disabled={!canSet}
            aria-label={label}
            aria-pressed={isActive}
            onClick={handleClick}
            {...buttonProps}
            ref={ref}>
            {children ?? <Icon className="size-3.5 shrink-0" />}
          </LinkButton>
        </PopoverTrigger>

        <PopoverContent portal={portal}>
          <LinkMain
            url={url}
            setUrl={setUrl}
            setLink={handleSetLink}
            removeLink={removeLink}
            openLink={openLink}
            isActive={isActive}
          />
        </PopoverContent>
      </Popover>
    )
  }
)

LinkPopover.displayName = 'LinkPopover'

export default LinkPopover
