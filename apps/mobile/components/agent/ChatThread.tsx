import { useRef, useEffect } from 'react'
import { FlatList, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { MessageBubble } from '@/components/agent/MessageBubble'
import { EmptyState } from '@/components/ui/EmptyState'
import { useThemeColors } from '@/components/ui/useThemeColors'
import type { ChatMessage } from '@/types/chat'
import { Bot } from 'lucide-react-native'

interface ChatThreadProps {
  messages: ChatMessage[]
  isStreaming: boolean
}

/**
 * Scrollable agent conversation thread.
 */
function ChatThread({ messages, isStreaming }: ChatThreadProps) {
  const listRef = useRef<FlatList<ChatMessage>>(null)
  const colors = useThemeColors()
  const { t } = useTranslation()

  useEffect(
    function () {
      if (messages.length === 0) {
        return
      }
      requestAnimationFrame(function () {
        listRef.current?.scrollToEnd({ animated: true })
      })
    },
    [messages, isStreaming]
  )

  if (messages.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <EmptyState
          icon={Bot}
          title={t('agentEmpty')}
          description={t('agentEmptyHint')}
        />
      </View>
    )
  }

  return (
    <FlatList
      ref={listRef}
      className="flex-1"
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <MessageBubble message={item} />}
      ListFooterComponent={
        isStreaming ? (
          <Text
            className="mb-2 text-xs"
            style={{ color: colors.textSecondary }}>
            {t('agentThinking')}
          </Text>
        ) : null
      }
    />
  )
}

export { ChatThread }
