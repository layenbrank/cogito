import { ScrollView, Text, View } from 'react-native'

import type { MagneticTile } from '@/types/magnetic-tile'

interface MarkdownTileProps {
  tile: MagneticTile
}

/**
 * Lightweight markdown preview tile (plain text lines).
 */
function MarkdownTile({ tile }: MarkdownTileProps) {
  const lines = (tile.content ?? tile.description).split('\n').slice(0, 8)

  return (
    <View className="flex-1 px-3 py-2">
      <Text
        className="mb-1 text-xs font-semibold opacity-70"
        style={{ color: tile.textColor ?? '#0F172A' }}>
        {tile.title}
      </Text>
      <ScrollView showsVerticalScrollIndicator={false}>
        {lines.map(function (line, index) {
          const isHeading = line.startsWith('#')
          const text = line.replace(/^#+\s*/, '').replace(/^-\s*/, '• ')
          return (
            <Text
              key={`${tile.id}-${index}`}
              className={isHeading ? 'mb-1 text-sm font-bold' : 'text-xs leading-5'}
              style={{ color: tile.textColor ?? '#0F172A' }}>
              {text}
            </Text>
          )
        })}
      </ScrollView>
    </View>
  )
}

export { MarkdownTile }
