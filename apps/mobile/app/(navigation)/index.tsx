import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { TileGrid } from '@/components/tiles/TileGrid'
import { Screen } from '@/components/ui/Screen'
import { useThemeColors } from '@/components/ui/useThemeColors'
import { findApiBaseUrl } from '@/constants/config'
import { useAuthStore } from '@/stores/authStore'
import { useTileStore } from '@/stores/tileStore'

export default function TilesScreen() {
  const { t } = useTranslation()
  const colors = useThemeColors()
  const insets = useSafeAreaInsets()
  const userId = useAuthStore((state) => state.userId)
  const tiles = useTileStore((state) => state.tiles)
  const isHydrated = useTileStore((state) => state.isHydrated)
  const hydrate = useTileStore((state) => state.hydrate)

  useEffect(
    function () {
      if (userId && !isHydrated) {
        void hydrate(userId)
      }
    },
    [userId, isHydrated, hydrate]
  )

  return (
    <Screen
      scroll
      edges={['left', 'right']}>
      <View
        style={{ paddingTop: insets.top + 8 }}
        className="gap-4 pb-8">
        <View className="gap-1">
          <Text
            className="text-3xl font-bold tracking-tight"
            style={{ color: colors.text }}>
            i-thinking
          </Text>
          <Text
            className="text-sm"
            style={{ color: colors.textSecondary }}>
            {t('tilesSubtitle')}
          </Text>
          <Text
            className="text-xs"
            style={{ color: colors.textSecondary }}>
            {t('authModeRemote')}: {findApiBaseUrl()}
          </Text>
        </View>
        <TileGrid tiles={tiles} />
      </View>
    </Screen>
  )
}
