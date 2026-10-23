import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { cn, type ClassValue } from 'cn'
import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { activateTile } from '@/features/magnetic-tile/activate'
import { Enter, ENTER, useEnter } from '@/features/magnetic-tile/enter'
import styles from '@/features/magnetic-tile/magnetic-tile.module.scss'
import { buildSurfaceStyle } from '@/features/magnetic-tile/surface-style'

interface SectionProps extends MagneticTile {
  children: ReactNode
  style?: CSSProperties
  className?: ClassValue
  size: MagneticTile.Size
  shape: MagneticTile.Shape
  direction: MagneticTile.Direction
  onTrash?: MouseEventHandler<HTMLElement>
  /** 覆盖默认双击打开；传入则不再调用 activateTile */
  onDoubleClick?: MouseEventHandler<HTMLElement>
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
  /**
   * 磁贴表面。双击默认走 `activateTile`（collection 为 scale 展开，其它在主窗口打开）；
   * 可用 `onDoubleClick` 覆盖（如集合抽屉选贴）。
   */
  Section(props: SectionProps) {
    const nodeRef = useRef<HTMLDivElement>(null)
    const enter = useEnter()
    const isReducedMotion = useReducedMotion()
    const isEnter = enter.isActive
    // 有入场时先不挂内容，等观察器确认在缓冲区内再挂，避免整表磁贴同时挂载
    const [isNear, setIsNear] = useState(!isEnter)
    const [hasEntered, setHasEntered] = useState(false)

    useEffect(function () {
      const el = nodeRef.current
      if (!el) return

      const root = el.closest('[data-mirror-scroller]')
      const scroller = root instanceof Element ? root : null
      const nearObserver = new IntersectionObserver(
        function (entries) {
          const entry = entries[entries.length - 1]
          if (!entry) return
          setIsNear(entry.isIntersecting)
        },
        {
          root: scroller,
          rootMargin: '100% 0px',
          threshold: 0
        }
      )
      const viewObserver = new IntersectionObserver(
        function (entries) {
          const isVisible = entries.some(function (entry) {
            return entry.isIntersecting
          })
          if (!isVisible) return
          setHasEntered(true)
          viewObserver.disconnect()
        },
        {
          root: scroller,
          threshold: 0
        }
      )
      nearObserver.observe(el)
      viewObserver.observe(el)
      return function () {
        nearObserver.disconnect()
        viewObserver.disconnect()
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
    const enterTransition = ENTER.transition(!!isReducedMotion)
    const isWaiting = isEnter && !isReducedMotion && !hasEntered

    return (
      <div
        ref={nodeRef}
        onDoubleClick={function (event) {
          if (props.onDoubleClick) {
            props.onDoubleClick(event)
            return
          }
          void activateTile(props)
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
          <m.div
            className={TILE_SURFACE}
            style={surfaceStyle}
            variants={ENTER.variants}
            initial={isReducedMotion ? false : 'hidden'}
            animate={isWaiting ? 'hidden' : 'show'}
            transition={enterTransition}>
            {surfaceBody}
          </m.div>
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
            'absolute -top-1.25 -right-1.25 z-10 flex size-4 cursor-pointer items-center justify-center rounded-full border-0 bg-red-500/50 text-white',
            'invisible pointer-events-none',
            props.onTrash &&
              'group-hover/tile:visible group-hover/tile:pointer-events-auto group-focus-within/tile:visible group-focus-within/tile:pointer-events-auto'
          )}>
          <Icon
            icon="ant-design:delete-outlined"
            width={10}
            height={10}
          />
        </button>
      </div>
    )
  }
}

export { MagneticTile }
export type { MagneticTileSuspenseProps, MarkerProps, SectionProps, SkeletonProps }
