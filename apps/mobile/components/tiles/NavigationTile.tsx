import { Text, View } from 'react-native'

import type { MagneticTile } from '@/types/magnetic-tile'

interface NavigationTileProps {
  tile: MagneticTile
}

/**
 * Bookmark / navigation magnetic tile.
 */
function NavigationTile({ tile }: NavigationTileProps) {
  return (
    <View className="flex-1 items-center justify-center gap-2 px-2">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-white/20">
        <Text
          className="text-lg font-bold"
          style={{ color: tile.textColor ?? '#FFFFFF' }}>
          {tile.mark ?? tile.title.slice(0, 1)}
        </Text>
      </View>
      <Text
        className="text-center text-sm font-semibold"
        numberOfLines={2}
        style={{ color: tile.textColor ?? '#FFFFFF' }}>
        {tile.title}
      </Text>
    </View>
  )
}

export { NavigationTile }
