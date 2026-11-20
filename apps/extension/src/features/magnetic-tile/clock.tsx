import { clsx } from 'clsx'
import { useEffect, useState } from 'react'

import { useTileDrag } from './drag-state.ts'
import { findGridSpan } from './layout.ts'
import { buildTileStyle } from './style.ts'
import { TileMenu } from './tile-menu.tsx'

const CLOCK_FORMAT: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
}

/** 墙面上的时钟磁贴，对应客户端里的 clock 组件 */
export function ClockTile(props: {
  tile: MagneticTile
  onEdit: (tile: MagneticTile) => void
  onRemove: (tile: MagneticTile) => void
}) {
  const [now, updateNow] = useState(function () {
    return new Date()
  })
  const tile = props.tile
  const drag = useTileDrag(tile.id)
  const span = findGridSpan(tile)

  useEffect(function () {
    const timer = window.setInterval(function () {
      updateNow(new Date())
    }, 1000)

    return function () {
      window.clearInterval(timer)
    }
  }, [])

  return (
    <div
      {...drag.dragProps}
      className={clsx(
        'group relative flex items-center justify-center overflow-hidden border border-border/60 shadow-sm',
        tile.shape === 'circle' ? 'rounded-full' : 'rounded-[var(--magnetic-tile-round,16px)]',
        drag.isOver ? 'ring-2 ring-ring' : null
      )}
      style={{
        ...buildTileStyle(tile),
        gridColumn: `span ${span.w}`,
        gridRow: `span ${span.h}`
      }}>
      <div className={clsx('flex flex-col items-center gap-1 text-card-foreground')}>
        <span className={clsx('text-3xl font-semibold tabular-nums')}>
          {now.toLocaleTimeString('zh-CN', CLOCK_FORMAT)}
        </span>
        <span className={clsx('text-xs opacity-80')}>{tile.title}</span>
      </div>
      <TileMenu
        title={tile.title}
        onEdit={function () {
          props.onEdit(tile)
        }}
        onRemove={function () {
          props.onRemove(tile)
        }}
      />
    </div>
  )
}
