import { forwardRef, useCallback, useMemo, useRef, useState } from 'react'

// --- Hooks ---
import { useMenuNavigation } from '@/hooks/use-menu-navigation.ts'
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

// --- Icons ---
import { ChevronDownIcon } from '@/components/tiptap-icons/chevron-down-icon.tsx'

// --- Tiptap UI ---
import type {
  ColorType,
  ColorItem,
  RecentColor,
  UseColorTextPopoverConfig
} from '@/components/tiptap-ui/color-text-popover/use-color-text-popover.ts'
import {
  useColorTextPopover,
  useRecentColors,
  findColorByValue
} from '@/components/tiptap-ui/color-text-popover/use-color-text-popover.ts'
import { TEXT_COLORS } from '@/components/tiptap-ui/color-text-button/use-color-text.ts'
import { ColorTextButton } from '@/components/tiptap-ui/color-text-button/color-text-button.tsx'
import { HIGHLIGHT_COLORS } from '@/components/tiptap-ui/color-highlight-button/use-color-highlight.ts'
import { ColorHighlightButton } from '@/components/tiptap-ui/color-highlight-button/color-highlight-button.tsx'

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
import {
  Card,
  CardBody,
  CardGroupLabel,
  CardItemGroup
} from '@/components/tiptap-ui-primitive/card/card.tsx'

// --- Utils ---
import { chunkArray } from '@/lib/tiptap-advanced-utils.ts'
import { ColorGroup } from '@/components/tiptap-ui/color-text-popover/color-group.tsx'

// --- Styles ---
import '@/components/tiptap-ui/color-text-popover/color-text-popover.scss'

export interface RenderColorButtonProps extends ButtonProps {
  colorObj: RecentColor
  withLabel?: boolean
  onColorChanged?: ({
    type,
    label,
    value
  }: {
    type: ColorType
    label: string
    value: string
  }) => void
}

export const RecentColorButton: React.FC<RenderColorButtonProps> = ({
  colorObj,
  withLabel = false,
  onColorChanged,
  ...props
}) => {
  const colorSet = colorObj.type === 'text' ? TEXT_COLORS : HIGHLIGHT_COLORS
  const color = findColorByValue(colorObj.value, colorSet)

  const commonProps = {
    tooltip: color.label,
    text: withLabel ? color.label : undefined,
    onApplied: () =>
      onColorChanged?.({
        type: colorObj.type,
        label: color.label,
        value: color.value
      }),
    ...props
  }

  return colorObj.type === 'text' ? (
    <ColorTextButton
      textColor={color.value}
      label={color.label}
      {...commonProps}
    />
  ) : (
    <ColorHighlightButton
      highlightColor={color.value}
      {...commonProps}
    />
  )
}

interface RecentColorsSectionProps {
  recentColors: RecentColor[]
  onColorSelected: ({
    type,
    label,
    value
  }: {
    type: ColorType
    label: string
    value: string
  }) => void
  selectedIndex?: number
}

const RecentColorsSection: React.FC<RecentColorsSectionProps> = ({
  recentColors,
  onColorSelected,
  selectedIndex
}) => {
  if (recentColors.length === 0) return null

  return (
    <CardItemGroup>
      <CardGroupLabel>Recently used</CardGroupLabel>
      <ButtonGroup orientation="horizontal">
        {recentColors.map((colorObj, index) => (
          <RecentColorButton
            key={`recent-${colorObj.type}-${colorObj.value}`}
            colorObj={colorObj}
            onColorChanged={onColorSelected}
            tabIndex={selectedIndex === index ? 0 : -1}
            data-highlighted={selectedIndex === index}
          />
        ))}
      </ButtonGroup>
    </CardItemGroup>
  )
}

export interface TextStyleColorSurfaceProps {
  maxColorsPerGroup?: number
  maxRecentColors?: number
  onColorChanged?: ({
    type,
    label,
    value
  }: {
    type: ColorType
    label: string
    value: string
  }) => void
}

export const TextStyleColorSurface: React.FC<TextStyleColorSurfaceProps> = ({
  maxColorsPerGroup = 5,
  maxRecentColors = 3,
  onColorChanged
}) => {
  const { recentColors, addRecentColor, isInitialized } =
    useRecentColors(maxRecentColors)

  const containerRef = useRef<HTMLDivElement>(null)

  const textColorGroups = useMemo(
    () => chunkArray(TEXT_COLORS, maxColorsPerGroup),
    [maxColorsPerGroup]
  )

  const highlightColorGroups = useMemo(
    () => chunkArray(HIGHLIGHT_COLORS, maxColorsPerGroup),
    [maxColorsPerGroup]
  )

  const allTextColors = useMemo(() => textColorGroups.flat(), [textColorGroups])

  const allHighlightColors = useMemo(
    () => highlightColorGroups.flat(),
    [highlightColorGroups]
  )

  const textColorStartIndex = useMemo(
    () => (isInitialized ? recentColors.length : 0),
    [isInitialized, recentColors.length]
  )

  const highlightColorStartIndex = useMemo(
    () => textColorStartIndex + allTextColors.length,
    [textColorStartIndex, allTextColors.length]
  )

  const menuItems = useMemo(() => {
    const items = []

    if (isInitialized && recentColors.length > 0) {
      items.push(
        ...recentColors.map((color) => ({
          type: color.type,
          value: color.value,
          label: color.type === 'text' ? t('EDITOR_RECENT_TEXT_COLOR') : t('EDITOR_RECENT_HIGHLIGHT_COLOR'),
          group: 'recent'
        }))
      )
    }

    items.push(
      ...allTextColors.map((color) => ({
        type: 'text' as ColorType,
        value: color.value,
        label: color.label,
        group: 'text'
      }))
    )

    items.push(
      ...allHighlightColors.map((color) => ({
        type: 'highlight' as ColorType,
        value: color.value,
        label: color.label,
        group: 'highlight'
      }))
    )

    return items
  }, [isInitialized, recentColors, allTextColors, allHighlightColors])

  const handleColorSelected = useCallback(
    ({
      type,
      label,
      value
    }: {
      type: ColorType
      label: string
      value: string
    }) => {
      if (!containerRef.current) return

      const highlightedElement = containerRef.current.querySelector(
        '[data-highlighted="true"]'
      ) as HTMLElement

      if (highlightedElement) {
        highlightedElement.click()
      }

      addRecentColor({ type, label, value })
      onColorChanged?.({ type, label, value })
    },
    [addRecentColor, onColorChanged]
  )

  const { selectedIndex } = useMenuNavigation({
    containerRef,
    items: menuItems,
    onSelect: (item) => {
      if (item) {
        handleColorSelected({
          type: item.type,
          label: item.label,
          value: item.value
        })
      }
    },
    orientation: 'both',
    autoSelectFirstItem: false
  })

  return (
    <Card
      ref={containerRef}
      tabIndex={0}
      role="menu">
      <CardBody>
        {isInitialized && (
          <RecentColorsSection
            recentColors={recentColors}
            onColorSelected={handleColorSelected}
            selectedIndex={selectedIndex}
          />
        )}

        <CardItemGroup>
          <CardGroupLabel>Text color</CardGroupLabel>
          <ColorGroup
            type="text"
            colors={textColorGroups}
            onColorSelected={handleColorSelected}
            selectedIndex={selectedIndex}
            startIndexOffset={textColorStartIndex}
          />
        </CardItemGroup>

        <CardItemGroup>
          <CardGroupLabel>Highlight color</CardGroupLabel>
          <ColorGroup
            type="highlight"
            colors={highlightColorGroups}
            onColorSelected={handleColorSelected}
            selectedIndex={selectedIndex}
            startIndexOffset={highlightColorStartIndex}
          />
        </CardItemGroup>
      </CardBody>
    </Card>
  )
}

export interface ColorTextPopoverProps
  extends Omit<ButtonProps, 'type'>, UseColorTextPopoverConfig {}

/**
 * Color text popover component for Tiptap editors.
 *
 * For custom popover implementations, use the `useColorTextPopover` hook instead.
 */
export const ColorTextPopover = forwardRef<
  HTMLButtonElement,
  ColorTextPopoverProps
>(
  (
    {
      editor: providedEditor,
      hideWhenUnavailable = false,
      onColorChanged,
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
      canToggle,
      activeTextStyle,
      activeHighlight,
      handleColorChanged,
      label,
      Icon
    } = useColorTextPopover({
      editor,
      hideWhenUnavailable,
      onColorChanged
    })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        setIsOpen(!isOpen)
      },
      [onClick, isOpen, setIsOpen]
    )

    if (!isVisible) {
      return null
    }

    return (
      <Popover
        open={isOpen}
        onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            data-style="ghost"
            data-appearance="default"
            role="button"
            aria-label={label}
            tooltip={label}
            disabled={!canToggle}
            data-disabled={!canToggle}
            onClick={handleClick}
            {...buttonProps}
            ref={ref}>
            {children ?? (
              <>
                <span
                  className="tiptap-button-color-text-popover"
                  style={
                    activeHighlight.color
                      ? ({
                          '--active-highlight-color': activeHighlight.color
                        } as React.CSSProperties)
                      : ({} as React.CSSProperties)
                  }>
                  <Icon
                    className="size-3.5 shrink-0"
                    style={{
                      color: activeTextStyle.color || undefined
                    }}
                  />
                </span>
                <ChevronDownIcon className="size-3 shrink-0 opacity-70" />
              </>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent
          style={{
            zIndex: '1000'
          }}
          aria-label={t('EDITOR_TEXT_COLOR_OPTIONS')}
          side="bottom"
          align="start">
          <TextStyleColorSurface onColorChanged={handleColorChanged} />
        </PopoverContent>
      </Popover>
    )
  }
)

ColorTextPopover.displayName = 'ColorTextPopover'

export default ColorTextPopover

import { t } from '@/views/knowledge/locale.ts'