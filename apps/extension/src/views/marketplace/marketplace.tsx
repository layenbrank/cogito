import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { clsx } from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  BOOTH_BUCKETS,
  NAVIGATE_BUCKETS,
  findNavigateBucketLabel,
  matchBoothBucket,
  matchNavigateBucket,
  type BoothBucket,
  type NavigateBucket
} from '@/constants/marketplace/buckets'
import { findTileHint } from '@/constants/marketplace/tile-hints'
import {
  findNavigationIconSrc,
  findNavigationLabel
} from '@/features/magnetic-tile/mark.ts'
import { appendTileCopy } from '@/features/mirror/insert.ts'
import { useMirrorStore } from '@/features/mirror/store.ts'
import { notify } from '@/features/shell/notice-state.ts'

type Mode = 'booth' | 'navigate'

function parseHostname(url: string | null): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch (error) {
    console.warn('[marketplace] 链接无法解析', error)
    return url
  }
}

function matchesQuery(tile: MagneticTile, query: string): boolean {
  if (!query) return true
  const haystack = `${tile.title} ${tile.description} ${tile.url ?? ''}`.toLowerCase()
  return haystack.includes(query)
}

/** 磁贴列表是入口：从这里把一块磁贴新增到当前镜像。 */
export default function Marketplace() {
  const navigate = useNavigate()
  const tiles = useMirrorStore(function (state) {
    return state.tiles
  })
  const initialize = useMirrorStore(function (state) {
    return state.initialize
  })
  const [mode, updateMode] = useState<Mode>('booth')
  const [boothBucket, updateBoothBucket] = useState<BoothBucket>('all')
  const [navigateBucket, updateNavigateBucket] = useState<NavigateBucket>('all')
  const [query, updateQuery] = useState('')
  const [pendingID, updatePendingID] = useState<string | null>(null)

  useEffect(
    function () {
      initialize()
    },
    [initialize]
  )

  const keyword = query.trim().toLowerCase()
  const listed = useMemo(
    function () {
      return tiles.filter(function (tile) {
        if (!matchesQuery(tile, keyword)) return false
        if (mode === 'booth') return matchBoothBucket(tile, boothBucket)
        return tile.component === 'navigation' && Boolean(tile.url) && matchNavigateBucket(tile, navigateBucket)
      })
    },
    [tiles, mode, boothBucket, navigateBucket, keyword]
  )

  async function addToMirror(tile: MagneticTile): Promise<void> {
    updatePendingID(tile.id)
    try {
      await appendTileCopy(tile)
      notify(`已把「${tile.title}」新增到镜像`)
    } catch (error) {
      console.error('[marketplace] 新增到镜像失败', error)
      notify('没有新增到镜像')
    } finally {
      updatePendingID(null)
    }
  }

  return (
    <div className={clsx('flex h-full min-h-0 flex-col bg-card/80')}>
      <header className={clsx('flex flex-wrap items-center gap-2 border-b border-border px-4 py-3')}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={function () {
            void navigate('/overview')
          }}>
          <Icon icon="lucide:arrow-left" aria-hidden />
          返回镜像
        </Button>
        <ToggleGroup
          spacing={0}
          variant="outline"
          value={[mode]}
          onValueChange={function (next) {
            const value = next[0] as Mode | undefined
            if (value === 'booth' || value === 'navigate') updateMode(value)
          }}>
          <ToggleGroupItem value="booth">磁贴</ToggleGroupItem>
          <ToggleGroupItem value="navigate">网址</ToggleGroupItem>
        </ToggleGroup>
        <Input
          value={query}
          placeholder={mode === 'booth' ? '搜索磁贴' : '搜索网址'}
          aria-label="搜索"
          className={clsx('max-w-xs')}
          onChange={function (event) {
            updateQuery(event.target.value)
          }}
        />
        <span className={clsx('ml-auto text-xs text-muted-foreground')}>
          {mode === 'booth' ? '全部' : findNavigateBucketLabel(navigateBucket)} · {listed.length}
          {mode === 'booth' ? ' 磁贴' : ' 网址'}
        </span>
      </header>

      <div className={clsx('overflow-x-auto overscroll-x-contain px-4 py-2')}>
        {mode === 'booth' ? (
          <ToggleGroup
            spacing={1}
            value={[boothBucket]}
            onValueChange={function (next) {
              const value = next[0] as BoothBucket | undefined
              if (value) updateBoothBucket(value)
            }}
            className={clsx('w-max')}>
            {BOOTH_BUCKETS.map(function (option) {
              return (
                <ToggleGroupItem key={option.value} value={option.value}>
                  {option.label}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        ) : (
          <ToggleGroup
            spacing={1}
            value={[navigateBucket]}
            onValueChange={function (next) {
              const value = next[0] as NavigateBucket | undefined
              if (value) updateNavigateBucket(value)
            }}
            className={clsx('w-max')}>
            {NAVIGATE_BUCKETS.map(function (option) {
              return (
                <ToggleGroupItem key={option.value} value={option.value}>
                  {option.label}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        )}
      </div>

      <div className={clsx('min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-4')}>
        {listed.length === 0 ? (
          <p className={clsx('px-1 py-6 text-sm text-muted-foreground')}>没有匹配的入口</p>
        ) : (
          <div className={clsx('grid grid-cols-1 gap-2.5 min-[640px]:grid-cols-2 min-[1100px]:grid-cols-3')}>
            {listed.map(function (tile) {
              return (
                <TileEntry
                  key={tile.id}
                  tile={tile}
                  isPending={pendingID === tile.id}
                  onAdd={function () {
                    void addToMirror(tile)
                  }}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function TileEntry(props: { tile: MagneticTile; isPending: boolean; onAdd: () => void }) {
  const tile = props.tile
  const iconSrc = findNavigationIconSrc(tile.mark, tile.url)
  const label = findNavigationLabel(tile.mark, tile.title)
  const hostname = parseHostname(tile.url)
  const [isBroken, updateBroken] = useState(false)
  const showsIcon = Boolean(iconSrc) && !isBroken

  return (
    <article className={clsx('flex min-h-22 items-start gap-3 rounded-2xl bg-card p-3.5 shadow-sm')}>
      <div
        className={clsx(
          'inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl text-sm font-semibold shadow-sm'
        )}
        style={{
          backgroundColor: tile.background?.color ?? '#ffffff',
          color: tile.textColor ? (tile.textColor.startsWith('#') ? tile.textColor : `#${tile.textColor}`) : undefined
        }}
        aria-hidden>
        {showsIcon ? (
          <img
            src={iconSrc!}
            alt=""
            className={clsx('size-full object-contain p-1.5')}
            onError={function () {
              console.warn('[marketplace] 图标加载失败', iconSrc)
              updateBroken(true)
            }}
          />
        ) : (
          label
        )}
      </div>
      <div className={clsx('flex min-w-0 flex-1 flex-col gap-0.5')}>
        <span className={clsx('truncate text-sm leading-[22px] font-semibold')}>{tile.title}</span>
        <span className={clsx('truncate text-xs leading-[18px] text-foreground/65')}>
          {tile.description && tile.description !== tile.title
            ? tile.description
            : findTileHint(tile.component, tile.title)}
        </span>
        {hostname ? (
          <span className={clsx('truncate text-xs leading-[18px] text-foreground/55')}>{hostname}</span>
        ) : null}
      </div>
      <Button
        type="button"
        size="icon-sm"
        title="新增到镜像"
        aria-label={`新增 ${tile.title}`}
        disabled={props.isPending}
        onClick={props.onAdd}>
        <Icon icon="lucide:plus" aria-hidden />
      </Button>
    </article>
  )
}
