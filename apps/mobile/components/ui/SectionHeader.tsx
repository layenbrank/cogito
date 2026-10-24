import type { LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

import { IconBadge } from '@/components/ui/IconBadge'
import { useThemeColors } from '@/components/ui/useThemeColors'

interface SectionHeaderProps {
  title: string
  description?: string
  icon?: LucideIcon
  trailing?: ReactNode
}

function SectionHeader({ title, description, icon, trailing }: SectionHeaderProps) {
  const colors = useThemeColors()

  return (
    <View className="mb-4 flex-row items-start gap-3">
      {icon ? (
        <IconBadge
          icon={icon}
          size="md"
        />
      ) : null}
      <View className="min-w-0 flex-1 gap-1">
        <Text
          className="text-xl font-bold tracking-tight"
          style={{ color: colors.text }}>
          {title}
        </Text>
        {description ? (
          <Text
            className="text-sm leading-5"
            style={{ color: colors.textSecondary }}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  )
}

export { SectionHeader }
