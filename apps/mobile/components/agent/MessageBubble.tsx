import { Text, View } from 'react-native'

import { useThemeColors } from '@/components/ui/useThemeColors'
import type { ChatMessage } from '@/types/chat'

interface MessageBubbleProps {
  message: ChatMessage
}

/**
 * Chat bubble for agent thread.
 */
function MessageBubble({ message }: MessageBubbleProps) {
  const colors = useThemeColors()
  const isUser = message.role === 'user'

  return (
    <View className={`mb-3 max-w-[88%] ${isUser ? 'self-end' : 'self-start'}`}>
      <View
        className="rounded-2xl px-4 py-3"
        style={{
          backgroundColor: isUser ? colors.tint : colors.surface,
          borderWidth: isUser ? 0 : 1,
          borderColor: colors.border
        }}>
        <Text
          className="text-[15px] leading-6"
          style={{ color: isUser ? '#FFFFFF' : colors.text }}>
          {message.content || '…'}
        </Text>
      </View>
    </View>
  )
}

export { MessageBubble }
