import type { ColorItem, ColorType } from '@/components/tiptap-ui/color-text-popover/use-color-text-popover.ts'
import { ColorHighlightButton } from '@/components/tiptap-ui/color-highlight-button/color-highlight-button.tsx'
import { ColorTextButton } from '@/components/tiptap-ui/color-text-button/color-text-button.tsx'
import { ButtonGroup } from '@/components/tiptap-ui-primitive/button/button.tsx'

interface ColorGroupProps {
  type: ColorType
  colors: ColorItem[][]
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
  startIndexOffset: number
}

function ColorGroup(props: ColorGroupProps) {
  const { type, colors, onColorSelected, selectedIndex, startIndexOffset } = props

  return colors.map(function (group, groupIndex) {
    return (
      <ButtonGroup
        key={`${type}-group-${groupIndex}`}
        orientation="horizontal">
        {group.map(function (color, colorIndex) {
          const itemIndex =
            startIndexOffset +
            colors.slice(0, groupIndex).reduce(function (acc, g) {
              return acc + g.length
            }, 0) +
            colorIndex

          const isHighlighted = selectedIndex === itemIndex

          const commonProps = {
            tooltip: color.label,
            onApplied: function () {
              onColorSelected({ type, label: color.label, value: color.value })
            },
            tabIndex: isHighlighted ? 0 : -1,
            'data-highlighted': isHighlighted,
            'aria-label': `${color.label} ${type === 'text' ? 'text' : 'highlight'} color`
          }

          return type === 'text' ? (
            <ColorTextButton
              key={`${type}-${color.value}-${colorIndex}`}
              textColor={color.value}
              label={color.label}
              {...commonProps}
            />
          ) : (
            <ColorHighlightButton
              key={`${type}-${color.value}-${colorIndex}`}
              highlightColor={color.value}
              {...commonProps}
            />
          )
        })}
      </ButtonGroup>
    )
  })
}

export { ColorGroup }
