import type { LucideIcon } from 'lucide-react-native'
import { ActivityIndicator, Pressable, Text } from 'react-native'

import { useThemeColors } from '@/components/ui/useThemeColors'

interface PrimaryButtonProps {
  label: string
  onPress: () => void
  icon?: LucideIcon
  loading?: boolean
  disabled?: boolean
  accessibilityLabel?: string
}

function PrimaryButton({
  label,
  onPress,
  icon: Icon,
  loading,
  disabled,
  accessibilityLabel
}: PrimaryButtonProps) {
  const colors = useThemeColors()
  const isDisabled = disabled || loading

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled }}
      className="min-h-[48px] flex-row items-center justify-center gap-2 rounded-xl active:opacity-80"
      disabled={isDisabled}
      onPress={onPress}
      style={{ backgroundColor: colors.tint, opacity: isDisabled ? 0.6 : 1 }}>
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <>
          {Icon ? (
            <Icon
              size={18}
              color="#FFFFFF"
              strokeWidth={2}
            />
          ) : null}
          <Text className="text-base font-semibold text-white">{label}</Text>
        </>
      )}
    </Pressable>
  )
}

interface SecondaryButtonProps {
  label: string
  onPress: () => void
  accessibilityLabel?: string
}

function SecondaryButton({ label, onPress, accessibilityLabel }: SecondaryButtonProps) {
  const colors = useThemeColors()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      className="min-h-[48px] flex-row items-center justify-center rounded-xl border active:opacity-70"
      onPress={onPress}
      style={{ borderColor: colors.border, backgroundColor: colors.surface }}>
      <Text
        className="text-base font-semibold"
        style={{ color: colors.tint }}>
        {label}
      </Text>
    </Pressable>
  )
}

export { PrimaryButton, SecondaryButton }
