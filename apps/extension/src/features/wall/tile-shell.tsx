import { Avatar, AvatarFallback, AvatarImage } from '@cogito/design/components/avatar'
import { clsx } from 'clsx'
import { useState, type CSSProperties, type MouseEvent } from 'react'

import { buildTileStyle } from '@/features/magnetic-tile/style.ts'
import { Glyph, type GlyphName } from '@/features/shell/glyph.tsx'
import { canActivate } from '@/features/wall/activation.ts'
import { ClockFace } from '@/features/wall/clock-face.tsx'
import { findTileBox } from '@/features/wall/metrics.ts'

const APP_ICON: Partial<Record<MagneticTile.Component, GlyphName>> = {
  bookmark: 'bookmark',
  settings: 'settings',
  collection: 'folder',
  code: 'grid',
  knowledge: 'grid',
  agent: 'grid',
  capture: 'grid'
}

interface WallTileProps {
  tile: MagneticTile
  now: Date
  isSelected: boolean
  memberCount: number
  onSelect: (event: MouseEvent<HTMLElement>) => void
  onActivate: () => void
}

function findLabel(title: string): string {
  const trimmed = title.trim()
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : '?'
}

/** 磁贴壳：表面在格子里，名称落在格子下方的间距里。 */
function WallTile(props: WallTileProps) {
  const { tile } = props
  const box = findTileBox(tile)
  const surface = buildTileStyle(tile)
  const hasPaint = Boolean(tile.background?.color || tile.background?.image)
  const ink = hasPaint ? (tile.textColor ?? 'var(--foreground)') : 'var(--foreground)'
  const radius = tile.shape === 'circle' ? '999px' : (tile.round ?? '12px')
  const shellStyle: CSSProperties = {
    gridColumn: box.columns > 1 ? `span ${box.columns}` : undefined,
    gridRow: box.rows > 1 ? `span ${box.rows}` : undefined,
    width: box.width,
    height: box.height
  }

  return (
    <article
      data-id={tile.id}
      className={clsx('magnetic-tile relative cursor-grab', props.isSelected && 'z-10')}
      style={shellStyle}
      onClick={props.onSelect}
      onDoubleClick={function (event) {
        event.preventDefault()
        if (canActivate(tile)) props.onActivate()
      }}>
      <div
        className={clsx(
          'absolute inset-0 flex items-center justify-center overflow-hidden shadow-md',
          props.isSelected && 'outline outline-2 outline-offset-2 outline-ring'
        )}
        style={{ ...surface, borderRadius: radius, color: ink }}>
        <TileFace
          tile={tile}
          now={props.now}
          memberCount={props.memberCount}
        />
      </div>
      <span
        className={clsx(
          'pointer-events-none absolute top-[calc(100%+6px)] left-0 z-1 block w-full truncate text-center text-xs leading-none text-foreground'
        )}
        style={{ textShadow: '0 1px 2px color-mix(in oklab, black 55%, transparent)' }}>
        {tile.title}
      </span>
    </article>
  )
}

function TileFace(props: { tile: MagneticTile; now: Date; memberCount: number }) {
  const { tile } = props
  if (tile.component === 'clock') return <ClockFace now={props.now} />

  const icon = APP_ICON[tile.component]
  if (icon && !tile.url) {
    return (
      <span className={clsx('flex size-full flex-col items-center justify-center gap-1')}>
        <Glyph
          name={icon}
          className={clsx('size-[42%]')}
        />
        {tile.component === 'collection' && tile.size > 1 ? (
          <span className={clsx('text-[10px] leading-none opacity-80')}>{props.memberCount}</span>
        ) : null}
      </span>
    )
  }

  return <SiteMark tile={tile} />
}

function SiteMark(props: { tile: MagneticTile }) {
  /** 记下“哪个 src 加载失败了”：换图时它自然不等于新 src，无需 effect 重置 */
  const [brokenSrc, updateBrokenSrc] = useState<string | null>(null)
  const src = props.tile.mark
  const radius = props.tile.shape === 'circle' ? 'rounded-full' : 'rounded-md'
  const isBroken = Boolean(src) && brokenSrc === src

  return (
    <Avatar
      className={clsx('size-[56%] max-w-none after:hidden', radius)}
      style={{ width: '56%', height: '56%' }}>
      {src && !isBroken ? (
        <AvatarImage
          src={src}
          alt=""
          className={clsx('size-full object-contain', radius)}
          onError={function () {
            updateBrokenSrc(src)
          }}
        />
      ) : null}
      <AvatarFallback className={clsx('bg-transparent text-2xl text-inherit', radius)}>
        {findLabel(props.tile.title)}
      </AvatarFallback>
    </Avatar>
  )
}

export { WallTile }
