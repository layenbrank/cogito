import type { LucideIcon } from 'lucide-react-native'
import { View } from 'react-native'

import { useThemeColors } from '@/components/ui/useThemeColors'

interface IconBadgeProps {
  icon: LucideIcon
  size?: 'md' | 'lg'
  tone?: 'brand' | 'muted'
}

/**
 * Circular icon badge used by empty states and section headers.
 */
function IconBadge({ icon: Icon, size = 'md', tone = 'brand' }: IconBadgeProps) {
  const colors = useThemeColors()
  const dimension = size === 'lg' ? 64 : 44
  const iconSize = size === 'lg' ? 28 : 20
  const backgroundColor = tone === 'brand' ? colors.tint : colors.surface
  const iconColor = tone === 'brand' ? '#FFFFFF' : colors.textSecondary
  const borderColor = tone === 'muted' ? colors.border : 'transparent'

  return (
    <View
      className="items-center justify-center rounded-full"
      style={{
        width: dimension,
        height: dimension,
        backgroundColor,
        borderWidth: tone === 'muted' ? 1 : 0,
        borderColor
      }}>
      <Icon
        color={iconColor}
        size={iconSize}
        strokeWidth={1.75}
      />
    </View>
  )
}

export { IconBadge }
