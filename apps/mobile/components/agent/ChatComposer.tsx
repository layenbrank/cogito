import { Send, Square } from 'lucide-react-native'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, TextInput, View } from 'react-native'

import { useThemeColors } from '@/components/ui/useThemeColors'

interface ChatComposerProps {
  disabled?: boolean
  isStreaming?: boolean
  onSend: (text: string) => void
  onAbort?: () => void
}

/**
 * Agent message composer with send / stop.
 */
function ChatComposer({ disabled, isStreaming, onSend, onAbort }: ChatComposerProps) {
  const { t } = useTranslation()
  const colors = useThemeColors()
  const [text, setText] = useState('')

  function submit() {
    const value = text.trim()
    if (!value || disabled || isStreaming) {
      return
    }
    onSend(value)
    setText('')
  }

  return (
    <View
      className="flex-row items-end gap-2 border-t px-3 py-3"
      style={{ borderTopColor: colors.border, backgroundColor: colors.surface }}>
      <TextInput
        accessibilityLabel={t('agentPlaceholder')}
        className="max-h-28 min-h-[44px] flex-1 rounded-2xl px-4 py-3 text-[15px]"
        editable={!disabled}
        multiline
        onChangeText={setText}
        placeholder={t('agentPlaceholder')}
        placeholderTextColor={colors.textSecondary}
        style={{
          backgroundColor: colors.background,
          color: colors.text,
          borderWidth: 1,
          borderColor: colors.border
        }}
        value={text}
      />
      {isStreaming ? (
        <Pressable
          accessibilityRole="button"
          className="h-11 w-11 items-center justify-center rounded-full active:opacity-80"
          onPress={onAbort}
          style={{ backgroundColor: colors.destructive }}>
          <Square
            color="#FFFFFF"
            fill="#FFFFFF"
            size={14}
          />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          className="h-11 w-11 items-center justify-center rounded-full active:opacity-80"
          disabled={disabled || !text.trim()}
          onPress={submit}
          style={{
            backgroundColor: colors.tint,
            opacity: disabled || !text.trim() ? 0.45 : 1
          }}>
          <Send
            color="#FFFFFF"
            size={18}
            strokeWidth={2}
          />
        </Pressable>
      )}
    </View>
  )
}

export { ChatComposer }
