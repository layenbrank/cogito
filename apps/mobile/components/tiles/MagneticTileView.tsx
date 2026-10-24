import { router } from 'expo-router'
import { Pressable, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'

import { ClockTile } from '@/components/tiles/ClockTile'
import { IntelligenceTile } from '@/components/tiles/IntelligenceTile'
import { MarkdownTile } from '@/components/tiles/MarkdownTile'
import { NavigationTile } from '@/components/tiles/NavigationTile'
import type { MagneticTile } from '@/types/magnetic-tile'

interface MagneticTileViewProps {
  tile: MagneticTile
  width: number
  height: number
}

/**
 * Maps size units to a span factor for the mobile grid.
 */
function findSpan(size: MagneticTile['size']) {
  if (size >= 3) {
    return 2
  }
  if (size === 2) {
    return 2
  }
  return 1
}

/**
 * Handles tile activation: open URL, agent route, or no-op.
 */
async function activateTile(tile: MagneticTile) {
  if (tile.component === 'intelligence' || tile.url === 'agent') {
    router.push('/(navigation)/agent')
    return
  }
  if (tile.url) {
    await WebBrowser.openBrowserAsync(tile.url)
  }
}

/**
 * Single magnetic tile shell with component reflection.
 */
function MagneticTileView({ tile, width, height }: MagneticTileViewProps) {
  const backgroundColor = tile.background?.color ?? '#334155'
  const radius = Number(tile.round ?? 16)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tile.title}
      className="overflow-hidden active:opacity-85"
      onPress={() => {
        void activateTile(tile)
      }}
      style={{
        width,
        height,
        borderRadius: Number.isFinite(radius) ? radius : 16,
        backgroundColor
      }}>
      <View className="flex-1">
        {tile.component === 'clock' ? <ClockTile tile={tile} /> : null}
        {tile.component === 'navigation' ? <NavigationTile tile={tile} /> : null}
        {tile.component === 'markdown' ? <MarkdownTile tile={tile} /> : null}
        {tile.component === 'intelligence' ? <IntelligenceTile tile={tile} /> : null}
        {tile.component !== 'clock' &&
        tile.component !== 'navigation' &&
        tile.component !== 'markdown' &&
        tile.component !== 'intelligence' ? (
          <NavigationTile tile={tile} />
        ) : null}
      </View>
    </Pressable>
  )
}

export { MagneticTileView, findSpan }
