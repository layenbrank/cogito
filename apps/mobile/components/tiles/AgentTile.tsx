import { Sparkles } from 'lucide-react-native'
import { Text, View } from 'react-native'

import type { MagneticTile } from '@/types/magnetic-tile'

interface AgentTileProps {
  tile: MagneticTile
}

/**
 * Agent 入口磁贴。
 */
function AgentTile({ tile }: AgentTileProps) {
  return (
    <View className="flex-1 justify-between px-3 py-3">
      <View className="flex-row items-center gap-2">
        <Sparkles
          color={tile.textColor ?? '#FFFFFF'}
          size={18}
          strokeWidth={2}
        />
        <Text
          className="text-sm font-bold"
          style={{ color: tile.textColor ?? '#FFFFFF' }}>
          {tile.title}
        </Text>
      </View>
      <Text
        className="text-xs leading-5 opacity-90"
        numberOfLines={3}
        style={{ color: tile.textColor ?? '#FFFFFF' }}>
        {tile.content ?? tile.description}
      </Text>
    </View>
  )
}

export { AgentTile }
