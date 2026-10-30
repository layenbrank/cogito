import { memo, useContext, useMemo, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'

import {
  findNavigateBucket,
  findNavigateBucketLabel,
  type NavigateBucket
} from '@/constants/marketplace/buckets'
import { MarketplaceContext } from '@/views/marketplace/workspace/context.tsx'
import { EmptyHint } from '@/views/marketplace/workspace/empty-hint'
import { IncrementButton } from '@/views/marketplace/workspace/increment-button'
import { insertTile } from '@/views/marketplace/workspace/lib/insert-tile.ts'
import { MOTION } from '@/views/marketplace/workspace/lib/motion.ts'

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
  const { query, onUpdateQuery, onUpdateNavigateBucket } = useContext(MarketplaceContext)
  const isReducedMotion = !!useReducedMotion()
  const magneticTiles = useMirrorStore(function (state) {
    return state.magneticTiles
  })

  const navigationTiles = useMemo(
    function () {
      return findNavigateTiles(magneticTiles, props.bucket, query)
    },
    [magneticTiles, props.bucket, query]
  )

  const listKey = useMemo(
    function () {
      return `${props.bucket}:${query.trim()}:${navigationTiles
        .map(function (tile) {
          return tile.id
        })
        .join(',')}`
    },
    [props.bucket, query, navigationTiles]
  )

  const hasQuery = query.trim().length > 0
  const listMotion = MOTION.listContainer(isReducedMotion)
  const itemMotion = MOTION.listItem(isReducedMotion)

  if (navigationTiles.length === 0) {
    return (
      <EmptyHint
        description={hasQuery ? '未找到匹配网址' : '该分类暂无网址'}
        actionLabel={hasQuery ? '清除搜索' : props.bucket !== 'all' ? '查看全部' : undefined}
        onAction={
          hasQuery
            ? function () {
                onUpdateQuery('')
              }
            : props.bucket !== 'all'
              ? function () {
                  onUpdateNavigateBucket('all')
                }
              : undefined
        }
      />
    )
  }

  return (
    <m.div
      key={listKey}
      className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-2.5 overflow-auto scroll-smooth p-0.5 min-[640px]:grid-cols-2 min-[1100px]:grid-cols-3"
      {...listMotion}>
      {navigationTiles.map(function (tile) {
        return (
          <m.div
            key={tile.id}
            {...itemMotion}>
            <NavigateCard tile={tile} />
          </m.div>
        )
      })}
    </m.div>
  )
}

function NavigateCardView(props: NavigateCardViewProps) {
  const tile = props.tile
  const [isIncrementing, onUpdateIncrementing] = useState(false)
  const [showsCheck, onUpdateShowsCheck] = useState(false)
  const marketplace = useContext(MarketplaceContext)
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
    const mirrorID = marketplace.targetMirrorID ?? activeMirrorID
    if (!mirrorID) {
      toast.warning('请先选择镜像')
      marketplace.focusMirrorSelect()
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
      onUpdateShowsCheck(true)
      window.setTimeout(function () {
        onUpdateShowsCheck(false)
      }, MOTION.SUCCESS_MS)
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
      className="flex min-h-22 items-start gap-3 rounded-2xl bg-card p-3.5 shadow-sm transition-shadow duration-150 hover:shadow-md">
      <div
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold shadow-sm"
        style={{
          backgroundColor: accent,
          color: tile.textColor ?? undefined
        }}
        aria-hidden>
        {mark}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          title={tile.title}
          className="truncate text-sm leading-[22px] font-semibold text-foreground">
          {tile.title}
        </span>
        <span
          title={description}
          className="truncate text-xs leading-[18px] text-foreground/65">
          {description}
        </span>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          {hostname ? (
            <a
              href={tile.url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-xs leading-[18px] text-foreground/55 hover:text-primary"
              onClick={function (event) {
                event.stopPropagation()
              }}>
              {hostname}
            </a>
          ) : null}
          <span className="shrink-0 text-[11px] leading-[18px] whitespace-nowrap text-foreground/45">
            {updatedLabel}
          </span>
        </div>
      </div>

      <div className="flex min-h-16 shrink-0 flex-col items-end justify-between gap-2 self-stretch">
        <span className="inline-flex h-5 min-w-7 items-center justify-center rounded-full bg-muted px-2 text-[11px] leading-5 text-foreground/70 tabular-nums">
          {tile.downloadCount}
        </span>
        <IncrementButton
          tileTitle={tile.title}
          isIncrementing={isIncrementing}
          showsCheck={showsCheck}
          className="size-7"
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
