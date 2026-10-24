import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'

import type { MagneticTile } from '@/types/magnetic-tile'

interface ClockTileProps {
  tile: MagneticTile
}

/**
 * Live clock magnetic tile.
 */
function ClockTile({ tile }: ClockTileProps) {
  const [now, setNow] = useState(() => new Date())

  useEffect(function () {
    const timer = setInterval(function () {
      setNow(new Date())
    }, 1000)
    return function () {
      clearInterval(timer)
    }
  }, [])

  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const date = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <View className="flex-1 justify-center gap-1 px-3 py-2">
      <Text
        className="text-xs font-medium opacity-70"
        style={{ color: tile.textColor ?? '#0F172A' }}>
        {tile.title}
      </Text>
      <Text
        className="text-2xl font-bold tabular-nums"
        style={{ color: tile.textColor ?? '#0F172A' }}>
        {time}
      </Text>
      <Text
        className="text-xs opacity-70"
        style={{ color: tile.textColor ?? '#0F172A' }}>
        {date}
      </Text>
    </View>
  )
}

export { ClockTile }
