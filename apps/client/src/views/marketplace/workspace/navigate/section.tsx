import { EmptyHint } from '@/views/marketplace/workspace/empty-hint'
import { IncrementButton } from '@/views/marketplace/workspace/increment-button'
import { memo, useContext, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'

import {
  findNavigateBucket,
  findNavigateBucketLabel,
  type NavigateBucket
} from '@/constants/marketplace/buckets'
import { MarketplaceContext } from '@/views/marketplace/workspace/context.tsx'
import { useEnterMotion } from '@/views/marketplace/workspace/hooks/use-enter-motion.ts'
import { findLayoutKey, findMotionKey } from '@/views/marketplace/workspace/lib/enter-motion.ts'
import { insertTile } from '@/views/marketplace/workspace/lib/insert-tile.ts'
import {
  findNavigateTiles,
  formatUpdatedAt
} from '@/views/marketplace/workspace/lib/tiles.ts'
import { useMirrorStore } from '@/stores/mirror.ts'

type SectionProps = {
  bucket: NavigateBucket
}

type NavigateCardViewProps = {
  tile: MagneticTile
}

function parseHostname(url: string | null) {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch (error) {
    // URL 不合法就用原文当域名（列表里本来就可能是任意字符串）
    console.debug('[marketplace] URL 不合法，直接回显原文:', error)
    return url
  }
}

function findTitleMark(title: string) {
  const trimmed = title.trim()
  if (!trimmed) return '#'
  return trimmed.slice(0, 1).toUpperCase()
}

function findTileDescription(tile: MagneticTile) {
  if (tile.description && tile.description !== tile.title) {
    return tile.description
  }
  const bucket = findNavigateBucket(tile)
  return `${findNavigateBucketLabel(bucket)}类网站`
}

function Section(props: SectionProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const { query } = useContext(MarketplaceContext)
  const magneticTiles = useMirrorStore(function (state) {
    return state.magneticTiles
  })

  const navigationTiles = useMemo(
    function () {
      return findNavigateTiles(magneticTiles, props.bucket, query)
    },
    [magneticTiles, props.bucket, query]
  )

  const motionKey = useMemo(
    function () {
      return findMotionKey(props.bucket, query, navigationTiles)
    },
    [props.bucket, query, navigationTiles]
  )
  const layoutKey = useMemo(
    function () {
      return findLayoutKey(navigationTiles)
    },
    [navigationTiles]
  )

  useEnterMotion(gridRef, motionKey, layoutKey)

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-2.5 overflow-hidden px-3 pt-2 pb-3">
      {navigationTiles.length === 0 ? (
        <EmptyHint description={query.trim() ? '未找到匹配网址' : '该分类暂无网址'} />
      ) : (
        <div
          ref={gridRef}
          className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2.5 overflow-auto scroll-smooth p-0.5 max-[900px]:grid-cols-1">
          {navigationTiles.map(function (tile) {
            return (
              <NavigateCard
                key={tile.id}
                tile={tile}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function NavigateCardView(props: NavigateCardViewProps) {
  const tile = props.tile
  const [isIncrementing, onUpdateIncrementing] = useState(false)
  const { targetMirrorID } = useContext(MarketplaceContext)
  const { activeMirrorID, mirrors, toInsertMagneticTile } = useMirrorStore(
    useShallow(function (state) {
      return {
        activeMirrorID: state.active.mirror?.id,
        mirrors: state.mirrors,
        toInsertMagneticTile: state.toInsertMagneticTile
      }
    })
  )
  const accent = tile.background?.color ?? '#DBEAFE'
  const hostname = parseHostname(tile.url)
  const mark = findTitleMark(tile.title)
  const description = findTileDescription(tile)
  const updatedLabel = formatUpdatedAt(tile.updatedAt)

  async function onIncrement() {
    const mirrorID = targetMirrorID ?? activeMirrorID
    if (!mirrorID) {
      toast.warning('请先选择镜像')
      return
    }

    const mirror = mirrors.find(function (item) {
      return item.id === mirrorID
    })
    const mirrorTitle = mirror?.title ?? '镜像'

    onUpdateIncrementing(true)
    try {
      await insertTile({
        tile,
        mirrorID,
        toInsertMagneticTile
      })
      toast.success(`已添加到 ${mirrorTitle}`)
    } catch (error) {
      console.error('[Marketplace] increment navigate tile failed:', error)
      toast.error(error instanceof Error ? error.message : '添加失败')
    } finally {
      onUpdateIncrementing(false)
    }
  }

  return (
    <article
      data-list-card=""
      className="flex min-h-24 items-start gap-3 rounded-xl border border-slate-900/8 bg-card p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-[border-color,box-shadow] duration-200 hover:border-primary/35 hover:shadow-[0_6px_16px_rgba(15,23,42,0.06)]">
      <div
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 text-base font-semibold"
        style={{
          backgroundColor: accent,
          color: tile.textColor ?? '#0F172A'
        }}
        aria-hidden>
        {mark}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          title={tile.title}
          className="truncate text-sm leading-[22px] font-medium text-slate-900">
          {tile.title}
        </span>
        <span
          title={description}
          className="truncate text-xs leading-[18px] text-slate-600">
          {description}
        </span>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          {hostname ? (
            <a
              href={tile.url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-xs leading-[18px] text-slate-500 hover:text-primary"
              onClick={function (event) {
                event.stopPropagation()
              }}>
              {hostname}
            </a>
          ) : null}
          <span className="shrink-0 text-[11px] leading-[18px] whitespace-nowrap text-slate-400">
            {updatedLabel}
          </span>
        </div>
      </div>

      <div className="flex min-h-16 shrink-0 flex-col items-end justify-between gap-2 self-stretch">
        <span className="inline-flex h-5 min-w-7 items-center justify-center rounded-full border border-slate-900/6 bg-slate-100 px-2 text-[11px] leading-5 text-slate-600 tabular-nums">
          {tile.downloadCount}
        </span>
        <IncrementButton
          tileTitle={tile.title}
          isIncrementing={isIncrementing}
          className="size-7 rounded-lg"
          onIncrement={function () {
            void onIncrement()
          }}
        />
      </div>
    </article>
  )
}

const NavigateCard = memo(NavigateCardView)

export default Section
