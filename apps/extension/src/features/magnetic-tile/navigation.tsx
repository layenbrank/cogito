import { clsx } from 'clsx'
import { useState } from 'react'

import { openSite } from '@/features/shell/open-site.ts'
import { useTileDrag } from './drag-state.ts'
import { findGridSpan } from './layout.ts'
import { buildTileStyle } from './style.ts'
import { TileMenu } from './tile-menu.tsx'

/**
 * 导航磁贴（shadcn 重写）：点击打开链接，悬停出现操作菜单。
 * 图标优先用 `mark`，加载失败或没有时退化成标题首字。
 */
export function NavigationTile(props: {
  tile: MagneticTile
  onEdit: (tile: MagneticTile) => void
  onRemove: (tile: MagneticTile) => void
}) {
  const [hasBrokenMark, updateBrokenMark] = useState(false)
  const tile = props.tile
  const drag = useTileDrag(tile.id)
  const span = findGridSpan(tile)
  const initial = tile.title.trim().charAt(0) || '·'
  const showMark = Boolean(tile.mark) && !hasBrokenMark

  function handleOpen(): void {
    if (!tile.url) return
    openSite(tile.url, 'here')
  }

  return (
    <div
      {...drag.dragProps}
      className={clsx(
        'group relative overflow-hidden border transition-shadow',
        'border-border/60 shadow-sm hover:shadow-md focus-within:shadow-md focus-within:ring-2 focus-within:ring-ring/40',
        tile.shape === 'circle' ? 'rounded-full' : 'rounded-[var(--magnetic-tile-round,16px)]',
        drag.isOver ? 'ring-2 ring-ring' : null
      )}
      style={{
        ...buildTileStyle(tile),
        gridColumn: `span ${span.w}`,
        gridRow: `span ${span.h}`
      }}>
      <button
        type="button"
        onClick={handleOpen}
        title={tile.url ?? '未设置链接'}
        className={clsx(
          'flex h-full w-full flex-col items-center justify-center gap-2 p-3 outline-none'
        )}>
        {showMark ? (
          <img
            src={tile.mark ?? ''}
            alt=""
            className={clsx('h-10 w-10 rounded-md object-contain')}
            onError={function () {
              updateBrokenMark(true)
            }}
          />
        ) : (
          <span className={clsx('text-xl font-semibold text-card-foreground')}>{initial}</span>
        )}
        <span className={clsx('max-w-full truncate text-xs text-card-foreground opacity-90')}>
          {tile.title}
        </span>
      </button>

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
