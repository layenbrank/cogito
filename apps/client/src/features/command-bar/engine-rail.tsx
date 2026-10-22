/**
 * 引擎切换：横向宽度展开；收起/展开圆角与外壳贴合
 *
 * 顺滑要点：
 * - 盒模型恒定（始终 p-0.5），只动画 width，避免 padding/bg 硬切抢布局
 * - 图标与芯片双层叠放 + opacity 交叉淡入，不做 absolute↔flow 切换
 * - 像素宽 + tween（无 spring / 无 overshoot）
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { motion, useReducedMotion } from 'motion/react'
import { useLayoutEffect, useRef, useState } from 'react'

import { ENGINES } from '@/constants/engine'
import { OMNIBAR_UI } from '@/features/command-bar/constants'

/** 外壳水平 padding 合计（p-0.5 × 2） */
const PAD_X = 4
/** 收起：内槽 28 + PAD_X → 与 size-7 对齐 */
const COLLAPSED_PX = 28 + PAD_X

/** Material 减速曲线，控制点 y ≤ 1，无回弹 */
const RAIL_EASE: [number, number, number, number] = [0.2, 0, 0, 1]

interface EngineRailProps {
  engineKey: string
  isExpanded: boolean
  /** 结果表面展开时外壳为上圆下直，左侧圆角需对齐 */
  isShellOpen?: boolean
  onExpand: (open: boolean) => void
  onChoose: (key: string) => void
}

function EngineRail({
  engineKey,
  isExpanded,
  isShellOpen = false,
  onExpand,
  onChoose
}: EngineRailProps) {
  const isReduced = useReducedMotion()
  const duration = isReduced ? 0 : OMNIBAR_UI.RAIL_MS / 1000
  const chipsRef = useRef<HTMLDivElement>(null)
  const [expandedWidth, setExpandedWidth] = useState(COLLAPSED_PX)

  const active =
    ENGINES.find(function (item) {
      return item.key === engineKey
    }) ?? ENGINES[0]

  useLayoutEffect(
    function measureExpanded() {
      const node = chipsRef.current
      if (!node) return
      const chips = node

      function measure() {
        const next = Math.ceil(chips.scrollWidth) + PAD_X
        if (next > 0) setExpandedWidth(next)
      }

      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(chips)
      return function () {
        observer.disconnect()
      }
    },
    [isShellOpen]
  )

  const radius = isShellOpen
    ? isExpanded
      ? 'rounded-tl-[10px] rounded-tr-lg rounded-br-lg rounded-bl-md'
      : 'rounded-tl-[10px] rounded-tr-md rounded-b-md'
    : 'rounded-full'

  const widthTransition = { type: 'tween' as const, duration, ease: RAIL_EASE }
  /** 展开：图标速隐、芯片略滞后显现；收起：芯片速隐、图标同步回显 */
  const iconFade = {
    type: 'tween' as const,
    duration: duration * 0.35,
    ease: RAIL_EASE
  }
  const chipsFade = isExpanded
    ? {
        type: 'tween' as const,
        duration: duration * 0.5,
        ease: RAIL_EASE,
        delay: isReduced ? 0 : duration * 0.12
      }
    : {
        type: 'tween' as const,
        duration: duration * 0.3,
        ease: RAIL_EASE
      }

  return (
    <motion.div
      className={cn(
        'relative h-8 shrink-0 self-center overflow-hidden p-0.5',
        'transition-colors',
        isExpanded ? 'bg-muted/60' : 'bg-transparent',
        radius
      )}
      style={{ transitionDuration: `${OMNIBAR_UI.RAIL_MS}ms` }}
      initial={false}
      animate={{ width: isExpanded ? expandedWidth : COLLAPSED_PX }}
      transition={widthTransition}>
      <motion.button
        type="button"
        tabIndex={isExpanded ? -1 : 0}
        aria-hidden={isExpanded}
        aria-label={`搜索引擎：${active.label}`}
        aria-expanded={isExpanded}
        title={active.label}
        className={cn(
          'absolute left-0.5 top-0.5 z-[1] flex size-7 items-center justify-center',
          'text-muted-foreground hover:bg-muted hover:text-foreground',
          isShellOpen ? 'rounded-md' : 'rounded-full'
        )}
        initial={false}
        animate={{ opacity: isExpanded ? 0 : 1 }}
        transition={iconFade}
        style={{ pointerEvents: isExpanded ? 'none' : 'auto' }}
        onClick={function () {
          onExpand(true)
        }}>
        <Icon icon={active.icon} aria-hidden className="size-4" />
      </motion.button>

      <motion.div
        ref={chipsRef}
        className="absolute left-0.5 top-0.5 flex h-7 min-w-max items-center gap-0"
        role="listbox"
        aria-hidden={!isExpanded}
        aria-label="选择搜索引擎"
        initial={false}
        animate={{ opacity: isExpanded ? 1 : 0 }}
        transition={chipsFade}
        style={{ pointerEvents: isExpanded ? 'auto' : 'none' }}>
        {ENGINES.map(function (item) {
          const isActive = item.key === engineKey
          return (
            <button
              key={item.key}
              type="button"
              role="option"
              tabIndex={isExpanded ? 0 : -1}
              aria-selected={isActive}
              className={cn(
                'flex h-full items-center gap-1 rounded-full px-2 text-xs transition-colors',
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onMouseDown={function (event) {
                event.preventDefault()
              }}
              onClick={function () {
                onChoose(item.key)
                onExpand(false)
              }}>
              <Icon icon={item.icon} aria-hidden className="size-3.5 shrink-0" />
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          )
        })}
      </motion.div>
    </motion.div>
  )
}

export { EngineRail }
