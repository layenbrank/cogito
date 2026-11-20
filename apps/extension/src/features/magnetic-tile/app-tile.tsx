import { clsx } from 'clsx'
import { useNavigate } from 'react-router-dom'

import { Glyph } from '@/features/shell/glyph.tsx'
import { useTileDrag } from './drag-state.ts'
import { findGridSpan } from './layout.ts'
import { buildTileStyle } from './style.ts'
import { TileMenu } from './tile-menu.tsx'

const ROUTES: Partial<Record<MagneticTile.Component, string>> = {
  bookmark: '/bookmarks',
  settings: '/settings'
}

const ICONS: Partial<Record<MagneticTile.Component, 'bookmark' | 'settings'>> = {
  bookmark: 'bookmark',
  settings: 'settings'
}

/** 打开扩展内部页的磁贴（书签、外观），对应客户端里点开应用窗口 */
export function AppTile(props: {
  tile: MagneticTile
  onEdit: (tile: MagneticTile) => void
  onRemove: (tile: MagneticTile) => void
}) {
  const navigate = useNavigate()
  const tile = props.tile
  const drag = useTileDrag(tile.id)
  const span = findGridSpan(tile)
  const path = ROUTES[tile.component] ?? '/overview'

  return (
    <div
      {...drag.dragProps}
      className={clsx(
        'group relative overflow-hidden border border-border/60 shadow-sm',
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
        className={clsx('flex h-full w-full flex-col items-center justify-center gap-2 p-3 outline-none')}
        onClick={function () {
          void navigate(path)
        }}>
        <Glyph
          name={ICONS[tile.component] ?? 'grid'}
          className={clsx('size-8 text-card-foreground')}
        />
        <span className={clsx('max-w-full truncate text-xs text-card-foreground')}>{tile.title}</span>
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
