import { useMemo } from 'react'
import { useWindowDimensions, View } from 'react-native'

import { MagneticTileView, findSpan } from '@/components/tiles/MagneticTileView'
import type { MagneticTile } from '@/types/magnetic-tile'

interface TileGridProps {
  tiles: MagneticTile[]
}

const GAP = 12
const COLUMNS = 2
const UNIT = 96

/**
 * Two-column magnetic tile grid inspired by Studio controller.
 */
function TileGrid({ tiles }: TileGridProps) {
  const { width } = useWindowDimensions()
  const horizontalPad = 20
  const cell = (width - horizontalPad * 2 - GAP * (COLUMNS - 1)) / COLUMNS

  const ordered = useMemo(
    function () {
      return [...tiles].sort((a, b) => a.index - b.index)
    },
    [tiles]
  )

  return (
    <View
      className="flex-row flex-wrap"
      style={{ gap: GAP }}>
      {ordered.map(function (tile) {
        const span = Math.min(findSpan(tile.size), COLUMNS)
        const tileWidth = span === COLUMNS ? cell * COLUMNS + GAP : cell
        const tileHeight = tile.size >= 2 ? UNIT * 1.35 : UNIT
        return (
          <MagneticTileView
            key={tile.id}
            height={tileHeight}
            tile={tile}
            width={tileWidth}
          />
        )
      })}
    </View>
  )
}

export { TileGrid }
