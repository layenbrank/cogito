import { forwardRef, useMemo, useRef, useState } from 'react'
import { type Editor } from '@tiptap/react'

// --- Hooks ---
import { useMenuNavigation } from '@/hooks/use-menu-navigation.ts'
import { useIsBreakpoint } from '@/hooks/use-is-breakpoint.ts'
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

// --- Icons ---
import { BanIcon } from '@/components/tiptap-icons/ban-icon.tsx'
import { HighlighterIcon } from '@/components/tiptap-icons/highlighter-icon.tsx'

// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button/button.tsx'
import {
  Button,
  ButtonGroup
} from '@/components/tiptap-ui-primitive/button/button.tsx'
import {
  Popover,
  PopoverTrigger,
  PopoverContent
} from '@/components/tiptap-ui-primitive/popover/popover.tsx'
import { Separator } from '@/components/tiptap-ui-primitive/separator/separator.tsx'
import {
  Card,
  CardBody,
  CardItemGroup
} from '@/components/tiptap-ui-primitive/card/card.tsx'

// --- Tiptap UI ---
import type {
  HighlightColor,
  UseColorHighlightConfig
} from '@/components/tiptap-ui/color-highlight-button/use-color-highlight.ts'
import {
  pickHighlightColorsByValue,
  useColorHighlight
} from '@/components/tiptap-ui/color-highlight-button/use-color-highlight.ts'
import { ColorHighlightButton } from '@/components/tiptap-ui/color-highlight-button/color-highlight-button.tsx'
import { t } from '@/views/knowledge/locale.ts'

export interface ColorHighlightPopoverContentProps {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * Optional colors to use in the highlight popover.
   * If not provided, defaults to a predefined set of colors.
   */
  colors?: HighlightColor[]
}

export interface ColorHighlightPopoverProps
  extends
    Omit<ButtonProps, 'type'>,
    Pick<
      UseColorHighlightConfig,
      'editor' | 'hideWhenUnavailable' | 'onApplied'
    > {
  /**
   * Optional colors to use in the highlight popover.
   * If not provided, defaults to a predefined set of colors.
   */
  colors?: HighlightColor[]
  /**
   * BubbleMenu 内须为 false。
   * @default true
   */
  portal?: boolean
}

export const ColorHighlightPopoverButton = forwardRef<
  HTMLButtonElement,
  ButtonProps
>(({ className, children, ...props }, ref) => (
  <Button
    type="button"
    className={className}
    data-style="ghost"
    data-appearance="default"
    role="button"
    tabIndex={-1}
    aria-label={t('EDITOR_HIGHLIGHT_TEXT')}
    tooltip={t('EDITOR_HIGHLIGHT')}
    ref={ref}
    {...props}>
    {children ?? <HighlighterIcon className="size-3.5 shrink-0" />}
  </Button>
))

ColorHighlightPopoverButton.displayName = 'ColorHighlightPopoverButton'

export function ColorHighlightPopoverContent({
  editor,
  colors = pickHighlightColorsByValue([
    'var(--tt-color-highlight-green)',
    'var(--tt-color-highlight-blue)',
    'var(--tt-color-highlight-red)',
    'var(--tt-color-highlight-purple)',
    'var(--tt-color-highlight-yellow)'
  ])
}: ColorHighlightPopoverContentProps) {
  const { handleRemoveHighlight } = useColorHighlight({ editor })
  const isMobile = useIsBreakpoint()
  const containerRef = useRef<HTMLDivElement>(null)

  const menuItems = useMemo(
    () => [...colors, { label: t('EDITOR_REMOVE_HIGHLIGHT'), value: 'none' }],
    [colors]
  )

  const { selectedIndex } = useMenuNavigation({
    containerRef,
    items: menuItems,
    orientation: 'both',
    onSelect: (item) => {
      if (!containerRef.current) return false
      const highlightedElement = containerRef.current.querySelector(
        '[data-highlighted="true"]'
      ) as HTMLElement
      if (highlightedElement) highlightedElement.click()
      if (item.value === 'none') handleRemoveHighlight()
      return true
    },
    autoSelectFirstItem: false
  })

  return (
    <Card
      ref={containerRef}
      tabIndex={0}
      style={isMobile ? { boxShadow: 'none', border: 0 } : {}}>
      <CardBody style={isMobile ? { padding: 0 } : {}}>
        <CardItemGroup orientation="horizontal">
          <ButtonGroup orientation="horizontal">
            {colors.map((color, index) => (
              <ColorHighlightButton
                key={color.value}
                editor={editor}
                highlightColor={color.value}
                tooltip={color.label}
                aria-label={`${color.label} highlight color`}
                tabIndex={index === selectedIndex ? 0 : -1}
                data-highlighted={selectedIndex === index}
              />
            ))}
          </ButtonGroup>
          <Separator />
          <ButtonGroup orientation="horizontal">
            <Button
              onClick={handleRemoveHighlight}
              aria-label={t('EDITOR_REMOVE_HIGHLIGHT')}
              tooltip={t('EDITOR_REMOVE_HIGHLIGHT')}
              tabIndex={selectedIndex === colors.length ? 0 : -1}
              type="button"
              role="menuitem"
              data-style="ghost"
              data-highlighted={selectedIndex === colors.length}>
              <BanIcon className="size-3.5 shrink-0" />
            </Button>
          </ButtonGroup>
        </CardItemGroup>
      </CardBody>
    </Card>
  )
}

export function ColorHighlightPopover({
  editor: providedEditor,
  colors = pickHighlightColorsByValue([
    'var(--tt-color-highlight-green)',
    'var(--tt-color-highlight-blue)',
    'var(--tt-color-highlight-red)',
    'var(--tt-color-highlight-purple)',
    'var(--tt-color-highlight-yellow)'
  ]),
  hideWhenUnavailable = false,
  onApplied,
  portal = true,
  ...props
}: ColorHighlightPopoverProps) {
  const { editor } = useTiptapEditor(providedEditor)
  const [isOpen, setIsOpen] = useState(false)
  const { isVisible, canColorHighlight, isActive, label, Icon } =
    useColorHighlight({
      editor,
      hideWhenUnavailable,
      onApplied
    })

  if (!isVisible) return null

  return (
    <Popover
      open={isOpen}
      onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <ColorHighlightPopoverButton
          disabled={!canColorHighlight}
          data-active-state={isActive ? 'on' : 'off'}
          data-disabled={!canColorHighlight}
          aria-pressed={isActive}
          aria-label={label}
          tooltip={label}
          {...props}>
          <Icon className="size-3.5 shrink-0" />
        </ColorHighlightPopoverButton>
      </PopoverTrigger>
      <PopoverContent
        portal={portal}
        style={{
          zIndex: '1000'
        }}
        aria-label={t('EDITOR_HIGHLIGHT_COLORS')}>
        <ColorHighlightPopoverContent
          editor={editor}
          colors={colors}
        />
      </PopoverContent>
    </Popover>
  )
}

export default ColorHighlightPopover
