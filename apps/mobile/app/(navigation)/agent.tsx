import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ChatComposer } from '@/components/agent/ChatComposer'
import { ChatThread } from '@/components/agent/ChatThread'
import { useThemeColors } from '@/components/ui/useThemeColors'
import { useAgentStore } from '@/stores/agentStore'
import { useAuthStore } from '@/stores/authStore'

export default function AgentScreen() {
  const { t } = useTranslation()
  const colors = useThemeColors()
  const insets = useSafeAreaInsets()
  const token = useAuthStore((state) => state.token)
  const messages = useAgentStore((state) => state.messages)
  const models = useAgentStore((state) => state.models)
  const model = useAgentStore((state) => state.model)
  const isStreaming = useAgentStore((state) => state.isStreaming)
  const error = useAgentStore((state) => state.error)
  const send = useAgentStore((state) => state.send)
  const abort = useAgentStore((state) => state.abort)
  const setModel = useAgentStore((state) => state.setModel)
  const hydrate = useAgentStore((state) => state.hydrate)

  useEffect(
    function () {
      void hydrate(token)
    },
    [token, hydrate]
  )

  function pickModel() {
    if (models.length === 0) {
      Alert.alert(t('agentModel'), t('agentNoModels'))
      return
    }
    Alert.alert(t('agentModel'), t('chooseOption'), [
      ...models.map(function (item) {
        return {
          text: item.label || item.name,
          onPress: () => setModel(item.name)
        }
      }),
      { text: t('cancel'), style: 'cancel' as const }
    ])
  }

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: colors.background, paddingBottom: insets.bottom }}>
      <View
        className="flex-row items-center justify-between border-b px-4 py-2"
        style={{ borderBottomColor: colors.border, backgroundColor: colors.surface }}>
        <Pressable
          accessibilityRole="button"
          onPress={pickModel}>
          <Text
            className="text-xs"
            style={{ color: colors.textSecondary }}>
            {t('agentModel')}: {model}
          </Text>
        </Pressable>
        {error ? (
          <Text
            className="max-w-[55%] text-right text-xs"
            style={{ color: colors.destructive }}>
            {error}
          </Text>
        ) : null}
      </View>
      <ChatThread
        isStreaming={isStreaming}
        messages={messages}
      />
      <ChatComposer
        disabled={!token}
        isStreaming={isStreaming}
        onAbort={abort}
        onSend={(text) => {
          if (!token) {
            return
          }
          void send(token, text)
        }}
      />
    </View>
  )
}
