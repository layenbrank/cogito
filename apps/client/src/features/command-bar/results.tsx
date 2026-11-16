/**
 * Everything 式结果列表（栏下非模态）
 */
import { Button } from '@cogito/design/components/button'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { useEffect, useMemo, useRef, useState } from 'react'

import { DOMAIN_ICON, DOMAIN_LABEL, FILTER_CHIPS } from '@/features/command-bar/constants'
import { groupHits } from '@/features/command-bar/rank'
import { Glide } from '@/components/glide/glide'
import type { DomainFilter, Hit } from '@/features/command-bar/types'

/** 滚动容器上下留白：与 `[scroll-padding-block:...]` 保持一致，选中行不会贴边 */
const SCROLL_PADDING = 8

interface ResultsSurfaceProps {
  hits: Hit[]
  navigation: number
  filter: DomainFilter
  isOpen: boolean
  onFilter: (filter: DomainFilter) => void
  onNavigate: (index: number) => void
  onSelect: (hit: Hit) => void
  /**
   * 面板相对输入框的位置：
   * - `below` / `above`：绝对定位贴住输入框（操作栏胶囊用）；
   * - `inline`：当成普通块跟随在输入行下面（灵龙岛整列用，不会有缝）。
   */
  placement?: 'below' | 'above' | 'inline'
}

function ResultsSurface(props: ResultsSurfaceProps) {
  const isReduced = useReducedMotion()
  /** 分类条能不能继续往两边滑：只有还能滑的那侧才盖渐隐 */
  const [scrollEdge, setScrollEdge] = useState({ start: false, end: true })
  const listRef = useRef<HTMLDivElement>(null)
  // 分组与扁平列表一次算完：原来一次渲染要分组两遍（findFlatHits 内部又分一次）
  const groups = useMemo(
    function () {
      return groupHits(props.hits)
    },
    [props.hits]
  )
  const flatHits = useMemo(
    function () {
      return groups.flatMap(function (group) {
        return group.hits
      })
    },
    [groups]
  )
  const isAbove = props.placement === 'above'
  const isInline = props.placement === 'inline'

  // 高亮行跟着键盘 / 鼠标走：只在需要时滚（nearest），并留出与 scroll-padding 一致的边距。
  // 手算 scrollTop 而不是 scrollIntoView：后者会把外层页面/祖先滚动容器一起滚。
  useEffect(
    function () {
      const container = listRef.current
      if (!container || props.navigation < 0) return
      const node = container.querySelector<HTMLElement>('[aria-selected="true"]')
      if (!node) return
      const box = container.getBoundingClientRect()
      const rect = node.getBoundingClientRect()
      const top = box.top + SCROLL_PADDING
      const bottom = box.bottom - SCROLL_PADDING
      const start = container.scrollTop
      let next = start
      if (rect.top < top) next -= top - rect.top
      else if (rect.bottom > bottom) next += rect.bottom - bottom
      if (next === start) return
      const max = container.scrollHeight - container.clientHeight
      // 直接设 scrollTop：键盘方向键要求「立刻到位」，平滑滚动在部分环境会被忽略，
      // 反而让高亮行停在视野外；行本身的颜色过渡已经把切换感做柔了。
      container.scrollTop = Math.max(0, Math.min(next, max))
    },
    [props.navigation, props.hits]
  )

  if (!props.isOpen) return null

  return (
    <AnimatePresence>
      <m.div
        key="results"
        initial={isReduced || isInline ? false : { opacity: 0, y: isAbove ? 4 : -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={isReduced || isInline ? undefined : { opacity: 0, y: isAbove ? 4 : -4 }}
        transition={{ duration: 0.18 }}
        className={cn(
          'z-30 w-full overflow-hidden',
          isInline
            ? // 灵动岛：背景由岛自身给，这里只画分隔线
              'border-border/50 bg-transparent relative border-t'
            : // 操作栏：与胶囊拼成一体（上圆角由胶囊那段负责，这里只给下圆角）
              cn(
                'bg-popover absolute left-0 max-h-[min(40vh,22rem)] border border-border/60 shadow-[0_24px_60px_-18px_rgb(0_0_0/0.4)]',
                // 拼缝那侧不画边框：否则灰头 + 白身之间会多一条线
                isAbove ? 'bottom-full rounded-t-[22px] border-b-0' : 'top-full rounded-b-[22px] border-t-0'
              )
        )}
        role="listbox"
        aria-label="搜索结果">
        {/* 分类条：iOS 分段控件观感（胶囊轨道 + 白底选中块），Glide 横向滑 */}
        <div className="border-border/50 relative shrink-0 border-b px-2 pt-1 pb-1.5">
          <Glide.X
            className="h-10 w-full"
            // 旋转后的容器把水平滚动映射到 scrollTop，所以物理水平方向对应 block 轴：
            // 保留 8px scroll-padding-block，点分类自动滚入视野时不会贴着边被裁
            classNames={{ wrapper: '[scroll-padding-block:8px]' }}
            onScroll={function (event) {
              // 旋转后的容器把水平滚动映射到 scrollTop
              const node = event.currentTarget
              const max = node.scrollHeight - node.clientHeight
              setScrollEdge({ start: node.scrollTop > 1, end: node.scrollTop < max - 1 })
            }}>
            <div
              role="tablist"
              aria-label="搜索范围"
              className="bg-muted/60 flex w-max items-center gap-0.5 rounded-full p-0.5">
              {FILTER_CHIPS.map(function (chip) {
                const isActive = props.filter === chip
                return (
                  <button
                    key={chip}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    title={
                      chip === 'file'
                        ? '支持 Everything 语法：!排除 ext:rs path:src *通配'
                        : undefined
                    }
                    onMouseDown={function (event) {
                      // 不抢输入框焦点，否则灵动岛会当成失焦收起
                      event.preventDefault()
                    }}
                    onClick={function () {
                      props.onFilter(chip)
                    }}
                    className={cn(
                      'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] leading-none font-medium transition-colors',
                      isActive
                        ? 'bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.12)]'
                        : 'text-muted-foreground hover:text-foreground'
                    )}>
                    <Icon
                      icon={DOMAIN_ICON[chip]}
                      aria-hidden
                      className={cn('size-3.5 shrink-0', isActive && 'text-primary')}
                    />
                    <span className="whitespace-nowrap">{DOMAIN_LABEL[chip]}</span>
                  </button>
                )
              })}
            </div>
          </Glide.X>
          {/* 两侧渐隐：给出「还能继续横向滑」的暗示，否则被裁一半的卡片像是坏了 */}
          {scrollEdge.start ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-8"
              style={{ backgroundImage: 'linear-gradient(to right, var(--popover), transparent)' }}
            />
          ) : null}
          {scrollEdge.end ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-8"
              style={{ backgroundImage: 'linear-gradient(to left, var(--popover), transparent)' }}
            />
          ) : null}
        </div>

        <div
          ref={listRef}
          className="max-h-[min(42vh,20rem)] overflow-y-auto py-2 [scrollbar-width:none] [scroll-padding-block:8px] [overscroll-behavior:contain] [&::-webkit-scrollbar]:hidden">
          {flatHits.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-[13px]">
              {props.filter === 'file'
                ? '无匹配文件 · 支持 !排除 ext:rs path:src *通配'
                : '无匹配结果'}
            </p>
          ) : (
            groups.map(function (group) {
              return (
                <div
                  key={group.domain}
                  className="mb-1 last:mb-0">
                  <div className="text-muted-foreground px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">
                    {DOMAIN_LABEL[group.domain]}
                  </div>
                  {group.hits.map(function (hit) {
                    const index = flatHits.indexOf(hit)
                    const isActive = index === props.navigation
                    return (
                      <Button
                        key={`${hit.domain}:${hit.id}`}
                        type="button"
                        variant="ghost"
                        role="option"
                        aria-selected={isActive}
                        className={cn(
                          // iOS 列表：整行淡色填充选中，不是卡片描边
                          'relative h-auto w-full justify-start gap-3 rounded-none px-3 py-2 text-left font-normal transition-colors duration-100',
                          isActive
                            ? 'bg-foreground/[0.06] hover:bg-foreground/[0.06]'
                            : 'hover:bg-foreground/[0.04] active:bg-foreground/[0.08]',
                          // 分隔线从文字起点开始（左侧让开图标），最后一行不画
                          'before:bg-border/60 before:absolute before:right-3 before:bottom-0 before:left-14 before:h-px before:content-[""] last:before:hidden'
                        )}
                        onMouseEnter={function () {
                          props.onNavigate(index)
                        }}
                        onMouseDown={function (event) {
                          event.preventDefault()
                        }}
                        onClick={function () {
                          props.onSelect(hit)
                        }}>
                        <span className="bg-muted/70 text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-[10px]">
                          <Icon
                            icon={hit.icon ?? 'lucide:search'}
                            aria-hidden
                            className="size-4"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] leading-tight font-medium">
                            {hit.title}
                          </span>
                          {hit.subtitle ? (
                            <span className="text-muted-foreground mt-0.5 block truncate text-[13px] leading-tight">
                              {hit.subtitle}
                            </span>
                          ) : null}
                        </span>
                      </Button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      </m.div>
    </AnimatePresence>
  )
}

export { ResultsSurface }
