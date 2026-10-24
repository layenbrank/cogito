import Constants from 'expo-constants'
import { router } from 'expo-router'
import { Settings } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { Alert, Text, View } from 'react-native'

import { PrimaryButton } from '@/components/ui/PrimaryButton'
import { Screen } from '@/components/ui/Screen'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SettingsLinkRow } from '@/components/ui/SwitchRow'
import { useThemeColors } from '@/components/ui/useThemeColors'
import { findApiBaseUrl } from '@/constants/config'
import i18n from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import { useAuthStore } from '@/stores/authStore'
import type { LanguagePreference, ThemePreference } from '@/stores/settingsStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTileStore } from '@/stores/tileStore'

/**
 * Builds a one-letter avatar initial from a username.
 */
function findAvatarInitial(username: string | null) {
  if (!username) {
    return '?'
  }
  return (username[0] ?? '?').toUpperCase()
}

export default function SettingsScreen() {
  const { t } = useTranslation()
  const colors = useThemeColors()
  const username = useAuthStore((state) => state.username)
  const profile = useAuthStore((state) => state.profile)
  const signOut = useAuthStore((state) => state.signOut)
  const theme = useSettingsStore((state) => state.theme)
  const language = useSettingsStore((state) => state.language)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const setLanguage = useSettingsStore((state) => state.setLanguage)
  const clearTiles = useTileStore((state) => state.clear)
  const clearAgent = useAgentStore((state) => state.clear)

  function themeLabel(value: ThemePreference) {
    if (value === 'light') return t('themeLight')
    if (value === 'dark') return t('themeDark')
    return t('themeSystem')
  }

  function languageLabel(value: LanguagePreference) {
    return value === 'zh' ? '中文' : 'English'
  }

  function pickTheme() {
    Alert.alert(t('theme'), t('chooseOption'), [
      { text: t('themeSystem'), onPress: () => setTheme('system') },
      { text: t('themeLight'), onPress: () => setTheme('light') },
      { text: t('themeDark'), onPress: () => setTheme('dark') },
      { text: t('cancel'), style: 'cancel' }
    ])
  }

  function pickLanguage() {
    Alert.alert(t('language'), t('chooseOption'), [
      {
        text: '中文',
        onPress: () => {
          setLanguage('zh')
          void i18n.changeLanguage('zh')
        }
      },
      {
        text: 'English',
        onPress: () => {
          setLanguage('en')
          void i18n.changeLanguage('en')
        }
      },
      { text: t('cancel'), style: 'cancel' }
    ])
  }

  async function handleSignOut() {
    clearAgent()
    clearTiles()
    await signOut()
    router.replace('/(auth)/login')
  }

  return (
    <Screen scroll>
      <SectionHeader
        icon={Settings}
        title={t('settings')}
        description={t('settingsSubtitle')}
      />

      <View
        className="mb-6 flex-row items-center gap-4 rounded-2xl border p-4"
        style={{ borderColor: colors.border, backgroundColor: colors.surface }}>
        <View
          className="h-12 w-12 items-center justify-center rounded-full"
          style={{ backgroundColor: colors.tint }}>
          <Text className="text-lg font-bold text-white">{findAvatarInitial(username)}</Text>
        </View>
        <View className="flex-1 gap-1">
          <Text
            className="text-base font-semibold"
            style={{ color: colors.text }}>
            {username ?? '—'}
          </Text>
          <Text
            className="text-xs"
            style={{ color: colors.textSecondary }}>
            {profile?.email || profile?.role || t('account')}
          </Text>
          <Text
            className="text-xs"
            style={{ color: colors.textSecondary }}>
            {findApiBaseUrl()}
          </Text>
        </View>
      </View>

      <View
        className="mb-6 overflow-hidden rounded-2xl border"
        style={{ borderColor: colors.border }}>
        <SettingsLinkRow
          label={t('theme')}
          value={themeLabel(theme)}
          onPress={pickTheme}
        />
        <SettingsLinkRow
          label={t('language')}
          value={languageLabel(language)}
          onPress={pickLanguage}
        />
        <SettingsLinkRow
          label={t('clearAgent')}
          value=""
          onPress={() => {
            clearAgent()
            Alert.alert(t('clearAgent'), t('clearAgentDone'))
          }}
        />
      </View>

      <View className="mb-4 gap-1">
        <Text
          className="text-xs"
          style={{ color: colors.textSecondary }}>
          {t('version')}: {Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
        <Text
          className="text-xs"
          style={{ color: colors.textSecondary }}>
          {t('aboutStudio')}
        </Text>
      </View>

      <PrimaryButton
        label={t('signOut')}
        onPress={() => void handleSignOut()}
      />
    </Screen>
  )
}
