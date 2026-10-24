import { ChevronRight } from 'lucide-react-native'
import { Pressable, Switch, Text, View } from 'react-native'

import { useThemeColors } from '@/components/ui/useThemeColors'

interface SwitchRowProps {
  label: string
  description?: string
  value: boolean
  onValueChange: (value: boolean) => void
}

function SwitchRow({ label, description, value, onValueChange }: SwitchRowProps) {
  const colors = useThemeColors()

  return (
    <View
      className="min-h-[56px] flex-row items-center justify-between gap-3 rounded-xl border px-4 py-3"
      style={{ borderColor: colors.border, backgroundColor: colors.surface }}>
      <View className="flex-1 gap-0.5">
        <Text
          className="text-base font-medium"
          style={{ color: colors.text }}>
          {label}
        </Text>
        {description ? (
          <Text
            className="text-sm"
            style={{ color: colors.textSecondary }}>
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        onValueChange={onValueChange}
        thumbColor="#FFFFFF"
        trackColor={{ false: colors.border, true: colors.tint }}
        value={value}
      />
    </View>
  )
}

interface SettingsLinkRowProps {
  label: string
  value?: string
  onPress: () => void
}

function SettingsLinkRow({ label, value, onPress }: SettingsLinkRowProps) {
  const colors = useThemeColors()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      className="min-h-[56px] flex-row items-center justify-between gap-3 rounded-xl border px-4 py-3 active:opacity-70"
      onPress={onPress}
      style={{ borderColor: colors.border, backgroundColor: colors.surface }}>
      <Text
        className="text-base font-medium"
        style={{ color: colors.text }}>
        {label}
      </Text>
      <View className="flex-row items-center gap-2">
        {value ? (
          <Text
            className="text-sm"
            style={{ color: colors.textSecondary }}>
            {value}
          </Text>
        ) : null}
        <ChevronRight
          size={18}
          color={colors.textSecondary}
          strokeWidth={1.75}
        />
      </View>
    </Pressable>
  )
}

export { SettingsLinkRow, SwitchRow }
