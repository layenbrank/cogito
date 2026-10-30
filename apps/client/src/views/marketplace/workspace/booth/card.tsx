import { Icon } from '@iconify/react/offline'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { memo, useContext, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { A11y, Navigation, Pagination, Virtual } from 'swiper/modules'
import { Swiper, type SwiperClass, SwiperSlide } from 'swiper/react'
import { useShallow } from 'zustand/react/shallow'

import 'swiper/css'
import 'swiper/css/virtual'
import 'swiper/css/navigation'
import 'swiper/css/pagination'

import { findTileHint } from '@/constants/marketplace/tile-hints'
import { Reflection } from '@/features/controller/reflection.tsx'
import { findMarkerBox } from '@/features/magnetic-tile/size.ts'
import { MagneticTile } from '@/features/magnetic-tile/magnetic-tile.tsx'
import { MarketplaceContext } from '@/views/marketplace/workspace/context.tsx'
import { useVisible } from '@/views/marketplace/workspace/hooks/use-visible.ts'
import { IncrementButton } from '@/views/marketplace/workspace/increment-button'
import { insertTile } from '@/views/marketplace/workspace/lib/insert-tile.ts'
import { MOTION } from '@/views/marketplace/workspace/lib/motion.ts'
import { formatUpdatedAt } from '@/views/marketplace/workspace/lib/tiles.ts'
import { useMirrorStore } from '@/stores/mirror.ts'

type BoothCardViewProps = {
  tile: MagneticTile
  scrollRoot: Element | null
}

type SizeOption = {
  label: string
  value: Mirror.Size
}

type ShapeOption = {
  label: string
  value: Mirror.Shape
  icon: string
}

type DirectionOption = {
  label: string
  value: Mirror.Direction
  icon: string
}

type PreviewStageProps = {
  size: Mirror.Size
  shape: Mirror.Shape
  direction: Mirror.Direction
  children: ReactNode
}

type StageSize = {
  w: number
  h: number
}

const SIZES: SizeOption[] = [1, 2, 3, 4, 5, 6, 7].map(function (value) {
  return { label: String(value), value: value as Mirror.Size }
})

const SHAPES: ShapeOption[] = [
  { label: '矩形', value: 'rectangle', icon: 'lucide:rectangle-horizontal' },
  { label: '正形', value: 'square', icon: 'lucide:square' },
  { label: '圆形', value: 'circle', icon: 'lucide:circle' }
]

const DIRECTIONS: DirectionOption[] = [
  { label: '水平', value: 'horizontal', icon: 'lucide:move-horizontal' },
  { label: '垂直', value: 'vertical', icon: 'lucide:move-vertical' }
]

const BOOT_SIZE: Mirror.Size = 1
const BOOT_SHAPE: Mirror.Shape = 'rectangle'
const BOOT_DIRECTION: Mirror.Direction = 'horizontal'
const STAGE_PAD = 16
/** 测量回退：按卡片 4:5、信息区约 7.5rem 估算预览台 */
const STAGE_FALLBACK: StageSize = { w: 280, h: 220 }

/** 比例落在整张卡上：宽变高也变，预览在卡内吃剩余高度 */
const CARD_CLASS = [
  'group/card flex aspect-[4/5] w-full flex-col overflow-hidden rounded-2xl bg-card shadow-sm',
  'transition-shadow duration-200 hover:shadow-md'
].join(' ')

const BADGE_CLASS =
  'inline-flex h-5 min-w-7 shrink-0 items-center justify-center rounded-full bg-muted px-2 text-[11px] leading-5 text-foreground/70 tabular-nums'

const SWIPER_CLASS = [
  'group/swiper !absolute inset-0 h-full w-full overflow-hidden',
  'bg-muted/70 bg-[radial-gradient(circle_at_center,color-mix(in_oklab,var(--foreground)_12%,transparent)_0.6px,transparent_0.7px)] bg-size-[10px_10px]',
  '[--swiper-navigation-size:22px]',
  '[&_.swiper-button-next]:right-2 [&_.swiper-button-next]:left-auto [&_.swiper-button-next]:size-7 [&_.swiper-button-next]:rounded-full [&_.swiper-button-next]:bg-card [&_.swiper-button-next]:text-foreground [&_.swiper-button-next]:shadow-md',
  '[&_.swiper-button-prev]:left-2 [&_.swiper-button-prev]:size-7 [&_.swiper-button-prev]:rounded-full [&_.swiper-button-prev]:bg-card [&_.swiper-button-prev]:text-foreground [&_.swiper-button-prev]:shadow-md',
  '[&_.swiper-button-next]:opacity-0 [&_.swiper-button-prev]:opacity-0',
  'group-hover/swiper:[&_.swiper-button-next]:opacity-100 group-hover/swiper:[&_.swiper-button-prev]:opacity-100',
  '[&_.swiper-button-next]:transition-opacity [&_.swiper-button-prev]:transition-opacity',
  '[&_.swiper-pagination]:!bottom-2',
  '[&_.swiper-pagination-bullet]:!size-1.5 [&_.swiper-pagination-bullet]:bg-foreground/30',
  '[&_.swiper-pagination-bullet-active]:bg-primary [&_.swiper-pagination-bullet-active]:opacity-100'
].join(' ')

/** 工具条内切换：无描边；选中主色浅底，避免白底+描边抢戏 */
const TOGGLE_ITEM = [
  'size-7 cursor-pointer rounded-md border-0 px-0 shadow-none',
  'text-foreground/50 hover:bg-background/70 hover:text-foreground',
  'aria-pressed:bg-primary/12 aria-pressed:text-primary aria-pressed:shadow-none',
  'data-[pressed]:bg-primary/12 data-[pressed]:text-primary data-[pressed]:shadow-none',
  'data-[state=on]:bg-primary/12 data-[state=on]:text-primary data-[state=on]:shadow-none',
  'focus-visible:ring-1 focus-visible:ring-primary/25'
].join(' ')

const TOOLBAR_DIVIDER = 'mx-0.5 h-3.5 w-px shrink-0 bg-foreground/10'

const SIZE_TRIGGER = [
  'h-7 w-auto min-w-8 shrink-0 gap-0.5 border-0 bg-transparent px-2',
  'text-xs font-medium tabular-nums shadow-none',
  'hover:bg-background/70 focus-visible:ring-1 focus-visible:ring-primary/25'
].join(' ')

const TOOLBAR_CLASS =
  'flex h-9 w-full items-center gap-0.5 rounded-xl bg-muted/65 p-1'

const ADD_IN_TOOLBAR =
  'size-7 shrink-0 rounded-md bg-primary text-primary-foreground shadow-none hover:bg-primary/90'

/**
 * 预览台按宿主尺寸等比缩放磁贴，保证任意 size/shape/direction 完整可见。
 */
function PreviewStage(props: PreviewStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [stage, onUpdateStage] = useState(STAGE_FALLBACK)
  const box = findMarkerBox({
    size: props.size,
    shape: props.shape,
    direction: props.direction
  })

  useLayoutEffect(
    function () {
      const node = hostRef.current
      if (!node) return

      function sync() {
        if (!node) return
        const nextW = Math.max(1, node.clientWidth - STAGE_PAD * 2)
        const nextH = Math.max(1, node.clientHeight - STAGE_PAD * 2)
        onUpdateStage(function (prev) {
          if (prev.w === nextW && prev.h === nextH) return prev
          return { w: nextW, h: nextH }
        })
      }

      sync()
      const observer = new ResizeObserver(sync)
      observer.observe(node)
      return function () {
        observer.disconnect()
      }
    },
    []
  )

  const scale = Math.min(1, stage.w / box.w, stage.h / box.h)
  const frameW = Math.max(1, Math.round(box.w * scale))
  const frameH = Math.max(1, Math.round(box.h * scale))

  return (
    <div
      ref={hostRef}
      className="flex h-full w-full items-center justify-center p-3 [&_.magnetic-tile-surface]:shadow-none dark:[&_.magnetic-tile-surface]:shadow-none">
      <div style={{ width: frameW, height: frameH }}>
        <div
          style={{
            width: box.w,
            height: box.h,
            transform: `scale(${scale})`,
            transformOrigin: 'top left'
          }}>
          {props.children}
        </div>
      </div>
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
  const hint = findTileHint(tile.component, tile.description)
  const showsBadge = tile.downloadCount > 0
  const canChooseDirection = shape === 'rectangle'

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

  function onChangeShape(value: Mirror.Shape) {
    onUpdateShape(value)
    if (value !== 'rectangle') {
      onUpdateDirection('horizontal')
    }
  }

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
        overrides: { size, shape, direction },
        toInsertMagneticTile
      })
      onUpdateShowsCheck(true)
      window.setTimeout(function () {
        onUpdateShowsCheck(false)
      }, MOTION.SUCCESS_MS)
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
      className={CARD_CLASS}>
      <div className="relative min-h-0 w-full flex-1">
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
            className={SWIPER_CLASS}
            pagination={{ clickable: true }}
            modules={[Navigation, Pagination, A11y, Virtual]}>
            {SIZES.map(function (sizeOption) {
              return (
                <SwiperSlide
                  key={sizeOption.value}
                  className="!h-full">
                  {sizeOption.value === size ? (
                    <PreviewStage
                      size={size}
                      shape={shape}
                      direction={direction}>
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
                    </PreviewStage>
                  ) : null}
                </SwiperSlide>
              )
            })}
          </Swiper>
        ) : (
          <div
            className="absolute inset-0 animate-pulse bg-muted"
            aria-hidden
          />
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2.5 border-t border-border/40 p-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3
              title={tile.title}
              className="min-w-0 flex-1 truncate text-sm leading-snug font-semibold text-foreground">
              {tile.title}
            </h3>
            {showsBadge ? <span className={BADGE_CLASS}>{tile.downloadCount}</span> : null}
          </div>
          <p className="truncate text-xs leading-relaxed text-foreground/55">
            <span title={hint}>{hint}</span>
            <span
              className="px-1 text-foreground/25"
              aria-hidden>
              ·
            </span>
            <span className="text-foreground/40">{formatUpdatedAt(tile.updatedAt)}</span>
          </p>
        </div>

        <div className={TOOLBAR_CLASS}>
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
              aria-label="尺寸"
              title="尺寸"
              className={SIZE_TRIGGER}>
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

          <span
            className={TOOLBAR_DIVIDER}
            aria-hidden
          />

          <ToggleGroup
            spacing={0}
            size="sm"
            value={[shape]}
            aria-label="形状"
            onValueChange={function (next) {
              const value = next[0] as Mirror.Shape | undefined
              if (!value) return
              onChangeShape(value)
            }}
            className="shrink-0 bg-transparent shadow-none">
            {SHAPES.map(function (option) {
              return (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  title={option.label}
                  aria-label={option.label}
                  className={TOGGLE_ITEM}>
                  <Icon
                    icon={option.icon}
                    className="size-3.5"
                    aria-hidden
                  />
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>

          {canChooseDirection ? (
            <>
              <span
                className={TOOLBAR_DIVIDER}
                aria-hidden
              />
              <ToggleGroup
                spacing={0}
                size="sm"
                value={[direction]}
                aria-label="方向"
                onValueChange={function (next) {
                  const value = next[0] as Mirror.Direction | undefined
                  if (!value) return
                  onUpdateDirection(value)
                }}
                className="shrink-0 bg-transparent shadow-none">
                {DIRECTIONS.map(function (option) {
                  return (
                    <ToggleGroupItem
                      key={option.value}
                      value={option.value}
                      title={option.label}
                      aria-label={option.label}
                      className={TOGGLE_ITEM}>
                      <Icon
                        icon={option.icon}
                        className="size-3.5"
                        aria-hidden
                      />
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>
            </>
          ) : null}

          <div className="ml-auto flex shrink-0 items-center pl-0.5">
            <IncrementButton
              tileTitle={tile.title}
              isIncrementing={isIncrementing}
              showsCheck={showsCheck}
              className={ADD_IN_TOOLBAR}
              onIncrement={function () {
                void onIncrement()
              }}
            />
          </div>
        </div>
      </div>
    </article>
  )
}

const BoothCard = memo(BoothCardView)

export { BoothCard }
