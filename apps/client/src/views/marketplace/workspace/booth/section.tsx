import { Badge } from '@i-thinking/design/components/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import { IncrementButton } from '@/views/marketplace/workspace/increment-button'
import { memo, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { A11y, Navigation, Pagination, Virtual } from 'swiper/modules'
import { Swiper, type SwiperClass, SwiperSlide } from 'swiper/react'
import { useShallow } from 'zustand/react/shallow'

import 'swiper/css'
import 'swiper/css/virtual'
import 'swiper/css/navigation'
import 'swiper/css/pagination'

import type { BoothBucket } from '@/constants/marketplace/buckets'
import { findTileHint } from '@/constants/marketplace/tile-hints'
import { Reflection } from '@/features/controller/reflection.tsx'
import { MagneticTile } from '@/features/magnetic-tile/magnetic-tile.tsx'
import { MarketplaceContext } from '@/views/marketplace/workspace/context.tsx'
import { useEnterMotion } from '@/views/marketplace/workspace/hooks/use-enter-motion.ts'
import { useVisible } from '@/views/marketplace/workspace/hooks/use-visible.ts'
import { findLayoutKey, findMotionKey } from '@/views/marketplace/workspace/lib/enter-motion.ts'
import { insertTile } from '@/views/marketplace/workspace/lib/insert-tile.ts'
import {
  findBoothTiles,
  formatUpdatedAt
} from '@/views/marketplace/workspace/lib/tiles.ts'
import { useMirrorStore } from '@/stores/mirror.ts'

type SectionProps = {
  bucket: BoothBucket
}

type SizeOption = {
  label: string
  value: Mirror.Size
}

type ShapeOption = {
  label: string
  value: Mirror.Shape
}

type DirectionOption = {
  label: string
  value: Mirror.Direction
}

type BoothCardViewProps = {
  tile: MagneticTile
  scrollRoot: Element | null
}

const SIZES: SizeOption[] = [1, 2, 3, 4, 5, 6, 7].map(function (value) {
  return { label: String(value), value: value as Mirror.Size }
})

const SHAPES: ShapeOption[] = [
  { label: '矩形', value: 'rectangle' },
  { label: '正形', value: 'square' },
  { label: '圆形', value: 'circle' }
]

const DIRECTIONS: DirectionOption[] = [
  { label: '水平', value: 'horizontal' },
  { label: '垂直', value: 'vertical' }
]

const BOOT_SIZE: Mirror.Size = 1
const BOOT_SHAPE: Mirror.Shape = 'rectangle'
const BOOT_DIRECTION: Mirror.Direction = 'horizontal'

const SWIPER_CLASS = [
  'group/swiper relative aspect-video w-1/2 min-w-0 overflow-hidden rounded-lg border border-border/60 bg-muted/40',
  '[--swiper-navigation-size:14px]',
  '[&_.swiper-button-next]:right-2.5 [&_.swiper-button-next]:left-auto [&_.swiper-button-next]:size-7 [&_.swiper-button-next]:rounded-full [&_.swiper-button-next]:bg-card [&_.swiper-button-next]:text-foreground [&_.swiper-button-next]:shadow-sm',
  '[&_.swiper-button-prev]:left-2.5 [&_.swiper-button-prev]:size-7 [&_.swiper-button-prev]:rounded-full [&_.swiper-button-prev]:bg-card [&_.swiper-button-prev]:text-foreground [&_.swiper-button-prev]:shadow-sm',
  '[&_.swiper-pagination-bullet]:bg-muted-foreground/60 [&_.swiper-pagination-bullet]:opacity-60',
  '[&_.swiper-pagination-bullet-active]:bg-primary [&_.swiper-pagination-bullet-active]:opacity-100'
].join(' ')

function findTitleMark(title: string) {
  const trimmed = title.trim()
  if (!trimmed) return '#'
  return trimmed.slice(0, 1).toUpperCase()
}

function Section(props: SectionProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollRoot, onUpdateScrollRoot] = useState<Element | null>(null)
  const { query } = useContext(MarketplaceContext)
  const magneticTiles = useMirrorStore(function (state) {
    return state.magneticTiles
  })

  const featureTiles = useMemo(
    function () {
      return findBoothTiles(magneticTiles, props.bucket, query)
    },
    [magneticTiles, props.bucket, query]
  )

  const motionKey = useMemo(
    function () {
      return findMotionKey(props.bucket, query, featureTiles)
    },
    [props.bucket, query, featureTiles]
  )
  const layoutKey = useMemo(
    function () {
      return findLayoutKey(featureTiles)
    },
    [featureTiles]
  )

  useLayoutEffect(
    function () {
      onUpdateScrollRoot(listRef.current)
    },
    [props.bucket, featureTiles.length]
  )

  useEnterMotion(listRef, motionKey, layoutKey)

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-2.5 overflow-hidden px-3 pt-2 pb-3">
      {featureTiles.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          {query.trim() ? '未找到匹配磁贴' : '该分类暂无磁贴'}
        </div>
      ) : (
        <div
          ref={listRef}
          className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto scroll-smooth p-0.5">
          {featureTiles.map(function (tile) {
            return (
              <BoothCard
                key={tile.id}
                tile={tile}
                scrollRoot={scrollRoot}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function BoothCardView(props: BoothCardViewProps) {
  const tile = props.tile
  const Component = Reflection[tile.component]
  const rootRef = useRef<HTMLElement>(null)
  const swiperRef = useRef<SwiperClass | null>(null)
  const isVisible = useVisible(rootRef, { root: props.scrollRoot })
  const [size, onUpdateSize] = useState(BOOT_SIZE)
  const [shape, onUpdateShape] = useState(BOOT_SHAPE)
  const [direction, onUpdateDirection] = useState(BOOT_DIRECTION)
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
  const hint = findTileHint(tile.component, tile.description)
  const mark = findTitleMark(tile.title)

  function onSlide(swiper: SwiperClass) {
    onUpdateSize(function (prev) {
      const value = SIZES.map(function (item) {
        return item.value
      })[swiper.realIndex]
      if (value) return value
      return prev
    })
  }

  function onChangeSize(value: Mirror.Size) {
    onUpdateSize(value)
    const index = SIZES.findIndex(function (item) {
      return item.value === value
    })
    if (index === -1) return
    swiperRef.current?.slideToLoop(index)
  }

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
        overrides: { size, shape, direction },
        toInsertMagneticTile
      })
      toast.success(`已添加到 ${mirrorTitle}`)
    } catch (error) {
      console.error('[Marketplace] increment booth tile failed:', error)
      toast.error(error instanceof Error ? error.message : '添加失败')
    } finally {
      onUpdateIncrementing(false)
    }
  }

  return (
    <article
      ref={rootRef}
      data-list-card=""
      className="flex w-full flex-row gap-3.5 rounded-xl border border-border bg-card p-3.5 shadow-xs transition-colors hover:border-primary/40">
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
        <div className="flex items-start gap-3">
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
            <div className="flex min-w-0 items-center gap-2">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {tile.title}
                    </span>
                  }
                />
                <TooltipContent side="bottom">{tile.title}</TooltipContent>
              </Tooltip>
              <Badge
                variant="secondary"
                className="h-5 shrink-0 px-2 tabular-nums">
                {tile.downloadCount}
              </Badge>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="truncate text-xs text-muted-foreground">{hint}</span>
                }
              />
              <TooltipContent side="bottom">{hint}</TooltipContent>
            </Tooltip>
            <span className="text-xs text-muted-foreground">
              {formatUpdatedAt(tile.updatedAt)}
            </span>
          </div>
        </div>

        <div className="grid w-full grid-cols-[repeat(3,minmax(0,1fr))_2.25rem] items-center gap-1.5">
          <Select
            items={SIZES.map(function (option) {
              return { value: String(option.value), label: option.label }
            })}
            value={String(size)}
            onValueChange={function (value) {
              if (value === null) return
              onChangeSize(Number(value) as Mirror.Size)
            }}>
            <SelectTrigger
              size="sm"
              aria-label="网格跨度">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIZES.map(function (option) {
                return (
                  <SelectItem
                    key={option.value}
                    value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>

          <Select
            items={SHAPES.map(function (option) {
              return { value: option.value, label: option.label }
            })}
            value={shape}
            onValueChange={function (value) {
              if (value === null) return
              onUpdateShape(value)
            }}>
            <SelectTrigger
              size="sm"
              aria-label="形状">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHAPES.map(function (option) {
                return (
                  <SelectItem
                    key={option.value}
                    value={option.value}>
                    {option.label}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>

          <Select
            items={DIRECTIONS.map(function (option) {
              return { value: option.value, label: option.label }
            })}
            value={direction}
            onValueChange={function (value) {
              if (value === null) return
              onUpdateDirection(value)
            }}>
            <SelectTrigger
              size="sm"
              aria-label="方向">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIRECTIONS.map(function (option) {
                return (
                  <SelectItem
                    key={option.value}
                    value={option.value}>
                    {option.label}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>

          <IncrementButton
            tileTitle={tile.title}
            isIncrementing={isIncrementing}
            onIncrement={function () {
              void onIncrement()
            }}
          />
        </div>
      </div>

      {isVisible ? (
        <Swiper
          virtual
          navigation
          loop={true}
          spaceBetween={0}
          slidesPerView={1}
          onSwiper={function (swiper) {
            swiperRef.current = swiper
          }}
          onSlideChange={onSlide}
          scrollbar={{ draggable: true }}
          className={SWIPER_CLASS}
          pagination={{ clickable: true }}
          modules={[Navigation, Pagination, A11y, Virtual]}>
          {SIZES.map(function (sizeOption) {
            return (
              <SwiperSlide
                key={sizeOption.value}
                className="flex items-center justify-center">
                {sizeOption.value === size ? (
                  <MagneticTile.Suspense
                    size={size}
                    shape={shape}
                    direction={direction}>
                    {Component ? (
                      <Component
                        {...tile}
                        size={size}
                        shape={shape}
                        direction={direction}
                      />
                    ) : null}
                  </MagneticTile.Suspense>
                ) : null}
              </SwiperSlide>
            )
          })}
        </Swiper>
      ) : (
        <div
          className="aspect-video w-1/2 min-w-0 animate-pulse rounded-lg border border-border/60 bg-muted/40"
          aria-hidden
        />
      )}
    </article>
  )
}

const BoothCard = memo(BoothCardView)

export default Section
