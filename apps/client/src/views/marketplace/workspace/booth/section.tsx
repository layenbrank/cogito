import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'

import type { BoothBucket } from '@/constants/marketplace/buckets'
import { BoothCard } from '@/views/marketplace/workspace/booth/card.tsx'
import { MarketplaceContext } from '@/views/marketplace/workspace/context.tsx'
import { EmptyHint } from '@/views/marketplace/workspace/empty-hint'
import { MOTION } from '@/views/marketplace/workspace/lib/motion.ts'
import { findBoothTiles } from '@/views/marketplace/workspace/lib/tiles.ts'
import { useMirrorStore } from '@/stores/mirror.ts'

type SectionProps = {
  bucket: BoothBucket
}

function Section(props: SectionProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollRoot, onUpdateScrollRoot] = useState<Element | null>(null)
  const { query, onUpdateQuery, onUpdateBoothBucket } = useContext(MarketplaceContext)
  const isReducedMotion = !!useReducedMotion()
  const magneticTiles = useMirrorStore(function (state) {
    return state.magneticTiles
  })

  const featureTiles = useMemo(
    function () {
      return findBoothTiles(magneticTiles, props.bucket, query)
    },
    [magneticTiles, props.bucket, query]
  )

  const listKey = useMemo(
    function () {
      return `${props.bucket}:${query.trim()}:${featureTiles
        .map(function (tile) {
          return tile.id
        })
        .join(',')}`
    },
    [props.bucket, query, featureTiles]
  )

  useLayoutEffect(
    function () {
      onUpdateScrollRoot(listRef.current)
    },
    [props.bucket, featureTiles.length]
  )

  const hasQuery = query.trim().length > 0
  const listMotion = MOTION.listContainer(isReducedMotion)
  const itemMotion = MOTION.listItem(isReducedMotion)

  if (featureTiles.length === 0) {
    return (
      <EmptyHint
        description={hasQuery ? '未找到匹配磁贴' : '该分类暂无磁贴'}
        actionLabel={hasQuery ? '清除搜索' : props.bucket !== 'all' ? '查看全部' : undefined}
        onAction={
          hasQuery
            ? function () {
                onUpdateQuery('')
              }
            : props.bucket !== 'all'
              ? function () {
                  onUpdateBoothBucket('all')
                }
              : undefined
        }
      />
    )
  }

  return (
    <m.div
      key={listKey}
      ref={listRef}
      className={[
        'grid min-h-0 flex-1 auto-rows-min content-start gap-3 overflow-auto scroll-smooth p-0.5',
        /* 抬高列地板 + auto-fit 收空列，大屏单卡不小于小窗观感 */
        '[grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))]'
      ].join(' ')}
      {...listMotion}>
      {featureTiles.map(function (tile) {
        return (
          <m.div
            key={tile.id}
            {...itemMotion}>
            <BoothCard
              tile={tile}
              scrollRoot={scrollRoot}
            />
          </m.div>
        )
      })}
    </m.div>
  )
}

export default Section
