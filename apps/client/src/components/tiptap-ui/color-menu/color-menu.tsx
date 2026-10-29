'use client'

import type { Editor } from '@tiptap/react'

// Primitive UI Components
import { Button } from '@/components/tiptap-ui-primitive/button/button.tsx'
import { Spacer } from '@/components/tiptap-ui-primitive/spacer/spacer.tsx'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuGroup,
  MenuGroupLabel,
  MenuButton
} from '@/components/tiptap-ui-primitive/menu/menu.tsx'
import { ComboboxList } from '@/components/tiptap-ui-primitive/combobox/combobox.tsx'
import { Separator } from '@/components/tiptap-ui-primitive/separator/separator.tsx'

// Tiptap UI
import {
  TEXT_COLORS,
  useColorText
} from '@/components/tiptap-ui/color-text-button/use-color-text.ts'
import {
  HIGHLIGHT_COLORS,
  useColorHighlight
} from '@/components/tiptap-ui/color-highlight-button/use-color-highlight.ts'
import type { RecentColor } from '@/components/tiptap-ui/color-text-popover/use-color-text-popover.ts'
import {
  findColorByValue,
  useRecentColors
} from '@/components/tiptap-ui/color-text-popover/use-color-text-popover.ts'

// Icons
import { PaintBucketIcon } from '@/components/tiptap-icons/paint-bucket-icon.tsx'
import { ChevronRightIcon } from '@/components/tiptap-icons/chevron-right-icon.tsx'
import { TextColorSmallIcon } from '@/components/tiptap-icons/text-color-small-icon.tsx'
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'
import { t } from '@/views/knowledge/locale.ts'

interface ColorMenuItemProps {
  color: { value: string; label: string }
}

const TextColorMenuItem: React.FC<ColorMenuItemProps> = ({ color }) => {
  const { addRecentColor } = useRecentColors()
  const { isActive, handleColorText, label } = useColorText({
    label: color.label,
    textColor: color.value,
    onApplied: ({ color, label }) =>
      addRecentColor({ type: 'text', label, value: color })
  })

  return (
    <MenuItem
      render={
        <Button
          data-style="ghost"
          data-active-state={isActive ? 'on' : 'off'}
        />
      }
      onClick={handleColorText}>
      <span
        className="tiptap-button-color-text"
        style={{ color: color.value }}>
        <TextColorSmallIcon
          className="size-3.5 shrink-0"
          style={{ color: color.value, flexGrow: 1 }}
        />
      </span>
      <span className="truncate text-xs">{label}</span>
    </MenuItem>
  )
}

const HighlightColorMenuItem: React.FC<ColorMenuItemProps> = ({ color }) => {
  const { addRecentColor } = useRecentColors()
  const { isActive, handleColorHighlight, label } = useColorHighlight({
    label: color.label,
    highlightColor: color.value,
    mode: 'node',
    onApplied: ({ color, label }) =>
      addRecentColor({ type: 'highlight', label, value: color })
  })

  return (
    <MenuItem
      render={
        <Button
          data-style="ghost"
          data-active-state={isActive ? 'on' : 'off'}
        />
      }
      onClick={handleColorHighlight}>
      <span
        className="tiptap-button-highlight"
        style={{ '--highlight-color': color.value } as React.CSSProperties}
      />
      <span className="truncate text-xs">{label}</span>
    </MenuItem>
  )
}

const RecentColorMenuItem: React.FC<{
  colorObj: RecentColor
}> = ({ colorObj }) => {
  const colorSet = colorObj.type === 'text' ? TEXT_COLORS : HIGHLIGHT_COLORS
  const color = findColorByValue(colorObj.value, colorSet)

  const ColorComponent =
    colorObj.type === 'text' ? TextColorMenuItem : HighlightColorMenuItem

  return <ColorComponent color={color} />
}

export interface ColorMenuProps {
  editor?: Editor | null
  /**
   * Custom trigger component. If not provided, uses default paint bucket button.
   */
  trigger?: React.ReactNode
  /**
   * Label for the color menu trigger
   * @default "Color"
   */
  label?: string
  /**
   * Menu placement relative to trigger
   * @default "right"
   */
  placement?: React.ComponentProps<typeof Menu>['placement']
}

/**
 * Reusable color menu component that provides text and highlight color options.
 * Includes recent colors, text colors, and highlight colors sections.
 */
export const ColorMenu: React.FC<ColorMenuProps> = ({
  editor: providedEditor,
  trigger,
  label = t('EDITOR_COLOR'),
  placement = 'right'
}) => {
  const { editor } = useTiptapEditor(providedEditor)
  const { recentColors, isInitialized } = useRecentColors()

  const hasColorActions: boolean =
    !!editor?.can().setMark('textStyle') ||
    !!editor?.can().setMark('highlight') ||
    !!editor?.can().toggleNodeBackgroundColor('yellow') ||
    false

  if (!editor || !hasColorActions) {
    return null
  }

  const defaultTrigger = (
    <MenuItem
      render={
        <MenuButton
          render={
            <Button data-style="ghost">
              <PaintBucketIcon className="size-3.5 shrink-0" />
              <span className="truncate text-xs">{label}</span>
              <Spacer />
              <ChevronRightIcon className="size-3.5 shrink-0" />
            </Button>
          }
        />
      }
    />
  )

  return (
    <Menu
      placement={placement}
      trigger={trigger || defaultTrigger}>
      <MenuContent
        style={{
          zIndex: 1000
        }}
        portal>
        <ComboboxList>
          {/* Recent Colors */}
          {isInitialized && recentColors.length > 0 && (
            <MenuGroup>
              <MenuGroupLabel>{t('EDITOR_RECENT_COLORS')}</MenuGroupLabel>
              {recentColors.map((colorObj) => (
                <RecentColorMenuItem
                  key={colorObj.value}
                  colorObj={colorObj}
                />
              ))}
              <Separator orientation="horizontal" />
            </MenuGroup>
          )}

          {/* Text Colors */}
          <MenuGroup>
            <MenuGroupLabel>{t('EDITOR_TEXT_COLOR')}</MenuGroupLabel>
            {TEXT_COLORS.map((textColor) => (
              <TextColorMenuItem
                key={textColor.value}
                color={textColor}
              />
            ))}
          </MenuGroup>

          <Separator orientation="horizontal" />

          {/* Background Colors */}
          <MenuGroup>
            <MenuGroupLabel>{t('EDITOR_BACKGROUND_COLOR')}</MenuGroupLabel>
            {HIGHLIGHT_COLORS.map((highlightColor) => (
              <HighlightColorMenuItem
                key={highlightColor.value}
                color={highlightColor}
              />
            ))}
          </MenuGroup>
        </ComboboxList>
      </MenuContent>
    </Menu>
  )
}

export { TextColorMenuItem, HighlightColorMenuItem, RecentColorMenuItem }
