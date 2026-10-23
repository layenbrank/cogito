import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { cn, type ClassValue } from 'cn'
import { motion, useReducedMotion } from 'motion/react'
import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { Enter, ENTER } from './enter'
import { useEnter } from './enter-context'
import styles from './magnetic-tile.module.scss'
import { buildSurfaceStyle } from './surface-style'

interface SectionProps extends MagneticTile {
  children: ReactNode
  style?: CSSProperties
  className?: ClassValue
  size: MagneticTile.Size
  shape: MagneticTile.Shape
  direction: MagneticTile.Direction
  onTrash?: MouseEventHandler<HTMLElement>
}

interface MarkerProps {
  children: ReactNode
  onDoubleClick?: MouseEventHandler<HTMLElement>
  style?: CSSProperties
  className?: ClassValue
  size: MagneticTile.Size
  shape: MagneticTile.Shape
  direction: MagneticTile.Direction
}

interface SkeletonProps {
  className?: ClassValue
  style?: CSSProperties
  id?: string
  size?: MagneticTile.Size
  shape?: MagneticTile.Shape
  direction?: MagneticTile.Direction
}

interface MagneticTileSuspenseProps extends SkeletonProps {
  children: ReactNode
  minDelayMs?: number
  fadeMs?: number
  skeletonClassName?: ClassValue
  skeletonStyle?: CSSProperties
}

type ActivateCtx = {
  tile: Pick<MagneticTile, 'component' | 'url'>
}

type ActivateFn = (ctx: ActivateCtx) => void | Promise<void>

/**
 * 双击侧通道：全部磁贴走独立窗口 / 系统浏览器。
 * - navigation → window.open（security setWindowOpenHandler → 默认浏览器）
 * - agent / directive → itc.window.toOpen
 * - capture → capture:open（截屏浮层窗）
 */
const SIDE_CHANNELS: Partial<Record<MagneticTile.Component, ActivateFn>> = {
  navigation(ctx) {
    if (!ctx.tile.url) return
    window.open(ctx.tile.url, '_blank', 'noopener')
  },
  async agent() {
    await itc.window.toOpen({ key: 'agent' })
  },
  async directive() {
    await itc.window.toOpen({ key: 'directive' })
  },
  async capture() {
    await window.itc.capture.open()
  }
}

function activateTile(tile: Pick<MagneticTile, 'component' | 'url'>) {
  const channel = SIDE_CHANNELS[tile.component]
  if (!channel) {
    console.warn('[magnetic-tile] 未登记窗口通道，忽略双击', tile.component)
    return
  }

  void Promise.resolve(channel({ tile })).catch(function (error) {
    console.error('[magnetic-tile] 窗口通道激活失败', error)
  })
}

const TILE_SHELL =
  'magnetic-tile group/tile relative cursor-pointer overflow-visible bg-transparent outline-none'

/** 表面 chrome：工具类在组件；深色孤岛 token / 拖拽态在 magnetic-tile.css */
const TILE_SURFACE =
  'magnetic-tile-surface size-full overflow-hidden [border-radius:inherit] [backface-visibility:hidden] shadow-[0_0_10px_rgba(0,0,0,0.1)] transition-shadow duration-300 ease-[cubic-bezier(0.165,0.84,0.44,1)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_6px_20px_rgba(0,0,0,0.38)]'

const MagneticTile = {
  /** 入场声明（Controller）；未包则 surface 无入场动画 */
  Enter,
  /** 纯展示；右键菜单由 Controller 层 ContextMenu 委托 */
  Marker(props: MarkerProps) {
    return (
      <div
        style={props.style}
        onDoubleClick={props.onDoubleClick}
        className={cn('flex size-full items-center justify-center overflow-hidden', props.className)}>
        {props.children}
      </div>
    )
  },
  Skeleton(props: SkeletonProps) {
    return (
      <div
        data-id={props.id}
        style={props.style}
        className={cn(
          TILE_SHELL,
          'magnetic-tile-skeleton animate-pulse rounded-[var(--magnetic-tile-round,12px)] bg-muted',
          styles.magneticTile,
          props.className,
          props.size ? styles[`lv${props.size}`] : null,
          props.shape ? styles[props.shape] : null,
          props.direction ? styles[props.direction] : null
        )}
      />
    )
  },
  Suspense(props: MagneticTileSuspenseProps) {
    return (
      <Suspense
        fallback={
          <MagneticTile.Skeleton
            id={props.id}
            size={props.size}
            shape={props.shape}
            direction={props.direction}
            style={props.skeletonStyle}
            className={cn(props.className, props.skeletonClassName)}
          />
        }>
        {props.children}
      </Suspense>
    )
  },

  Section(props: SectionProps) {
    const nodeRef = useRef<HTMLDivElement>(null)
    // 默认近视口，避免首屏先空 surface 再挂 Marker 闪一下
    const [isNear, setIsNear] = useState(true)
    const enter = useEnter()
    const isReducedMotion = useReducedMotion()
    const isEnter = enter.isActive
    // 锁定首挂 index：重排改序不重算 stagger，避免误触发观感变化
    const staggerIndexRef = useRef(enter.index)

    useEffect(function () {
      const el = nodeRef.current
      if (!el) return

      const root = el.closest('[data-mirror-scroller]')
      const observer = new IntersectionObserver(
        function (entries) {
          for (const entry of entries) {
            // 滞回：进入即 true；离开后仍保持一屏缓冲（rootMargin）才 false
            setIsNear(entry.isIntersecting)
          }
        },
        {
          root: root ?? null,
          rootMargin: '100% 0px',
          threshold: 0
        }
      )
      observer.observe(el)
      return function () {
        observer.disconnect()
      }
    }, [])

    const surfaceStyle = useMemo(
      function () {
        return buildSurfaceStyle({
          round: props.round,
          background: props.background,
          backdrop: props.backdrop,
          textColor: props.textColor
        })
      },
      [props.round, props.background, props.backdrop, props.textColor]
    )

    const surfaceBody = isNear ? props.children : null
    const enterTransition = ENTER.transition(staggerIndexRef.current, !!isReducedMotion)

    return (
      <div
        ref={nodeRef}
        onDoubleClick={function () {
          activateTile(props)
        }}
        data-id={props.id}
        className={cn(
          TILE_SHELL,
          styles.magneticTile,
          props.className,
          styles[`lv${props.size}`],
          styles[props.shape],
          styles[props.direction]
        )}
        style={props.style}>
        {isEnter ? (
          <motion.div
            className={TILE_SURFACE}
            style={surfaceStyle}
            variants={ENTER.variants}
            initial={isReducedMotion ? false : 'hidden'}
            animate="show"
            transition={enterTransition}>
            {surfaceBody}
          </motion.div>
        ) : (
          <div
            className={TILE_SURFACE}
            style={surfaceStyle}>
            {surfaceBody}
          </div>
        )}
        <span className="absolute top-[calc(100%_+_6px)] left-0 z-1 block w-full truncate text-center text-sm leading-none text-muted-foreground">
          <Tooltip>
            <TooltipTrigger render={<span>{props.title}</span>} />
            <TooltipContent side="bottom">{props.title}</TooltipContent>
          </Tooltip>
        </span>
        <button
          type="button"
          aria-label="删除磁贴"
          onClick={props.onTrash}
          className={cn(
            'absolute -top-[5px] -right-[5px] z-10 flex size-4 cursor-pointer items-center justify-center rounded-full border-0 bg-red-500/50 text-xs leading-none text-white',
            'invisible pointer-events-none',
            props.onTrash &&
              'group-hover/tile:visible group-hover/tile:pointer-events-auto group-focus-within/tile:visible group-focus-within/tile:pointer-events-auto'
          )}>
          X
        </button>
      </div>
    )
  }
}

export { MagneticTile }

export type { MarkerProps, SectionProps }
