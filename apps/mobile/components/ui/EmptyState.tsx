import type { LucideIcon } from 'lucide-react-native'
import { Text, View } from 'react-native'

import { IconBadge } from '@/components/ui/IconBadge'
import { PrimaryButton } from '@/components/ui/PrimaryButton'
import { useThemeColors } from '@/components/ui/useThemeColors'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}

function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  const colors = useThemeColors()

  return (
    <View className="flex-1 items-center justify-center gap-4 px-6 py-12">
      <IconBadge
        icon={icon}
        size="lg"
        tone="muted"
      />
      <View className="gap-2">
        <Text
          className="text-center text-lg font-semibold"
          style={{ color: colors.text }}>
          {title}
        </Text>
        <Text
          className="text-center text-sm leading-6"
          style={{ color: colors.textSecondary }}>
          {description}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <View className="mt-2 w-full max-w-xs">
          <PrimaryButton
            label={actionLabel}
            onPress={onAction}
          />
        </View>
      ) : null}
    </View>
  )
}

export { EmptyState }
