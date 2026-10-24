import type { LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Text, TextInput, View } from 'react-native'

import { useThemeColors } from '@/components/ui/useThemeColors'

interface FormFieldProps {
  label: string
  error?: string
  icon?: LucideIcon
  children?: ReactNode
  accessibilityLabel?: string
  value?: string
  onChangeText?: (text: string) => void
  onBlur?: () => void
  placeholder?: string
  secureTextEntry?: boolean
  keyboardType?: 'default' | 'email-address'
  autoCapitalize?: 'none' | 'sentences'
}

function FormField({
  label,
  error,
  icon: Icon,
  children,
  accessibilityLabel,
  value,
  onChangeText,
  onBlur,
  placeholder,
  secureTextEntry,
  keyboardType = 'default',
  autoCapitalize = 'sentences'
}: FormFieldProps) {
  const colors = useThemeColors()

  return (
    <View className="gap-2">
      <Text
        className="text-sm font-medium"
        style={{ color: colors.text }}>
        {label}
      </Text>
      <View
        className="min-h-[48px] flex-row items-center gap-3 rounded-xl border px-3"
        style={{
          backgroundColor: colors.surface,
          borderColor: error ? colors.destructive : colors.border
        }}>
        {Icon ? (
          <Icon
            size={18}
            color={colors.textSecondary}
            strokeWidth={1.75}
          />
        ) : null}
        {children ?? (
          <TextInput
            accessibilityLabel={accessibilityLabel ?? label}
            autoCapitalize={autoCapitalize}
            autoCorrect={false}
            className="h-12 flex-1 text-base"
            keyboardType={keyboardType}
            onBlur={onBlur}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.textSecondary}
            secureTextEntry={secureTextEntry}
            style={{ color: colors.text, textAlignVertical: 'center', paddingVertical: 0 }}
            value={value}
          />
        )}
      </View>
      {error ? (
        <Text
          className="text-sm"
          style={{ color: colors.destructive }}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}

export { FormField }
