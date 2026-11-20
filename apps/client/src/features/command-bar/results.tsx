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
  /** 灵动岛（inline）用更紧的边距，和更矮的行一起，让同一视口装下更多结果 */
  const scrollPadding = isInline ? 4 : SCROLL_PADDING

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
      const top = box.top + scrollPadding
      const bottom = box.bottom - scrollPadding
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
    [props.navigation, props.hits, scrollPadding]
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
        {/* 分类条：胶囊轨道 + 选中块。灵动岛收一档（条 28 / 芯片 24），操作栏保持原密度 */}
        <div
          className={cn(
            'border-border/50 relative shrink-0 border-b',
            isInline ? 'px-1.5 py-1' : 'px-2 pt-1 pb-1.5'
          )}>
          <Glide.X
            className={cn('w-full', isInline ? 'h-7' : 'h-10')}
            // 旋转后的容器把水平滚动映射到 scrollTop，所以物理水平方向对应 block 轴。
            // 留一点 scroll-padding，点分类滚入视野时不会贴着边被裁。
            classNames={{
              wrapper: isInline ? '[scroll-padding-block:4px]' : '[scroll-padding-block:8px]'
            }}
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
                  <Button
                    key={chip}
                    type="button"
                    variant="ghost"
                    size={isInline ? 'xs' : 'default'}
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
                      'shrink-0 rounded-full leading-none font-medium shadow-none',
                      isInline ? 'h-6 gap-1 px-2 text-[11px]' : 'h-8 gap-1.5 px-3 text-[13px]',
                      isActive
                        ? 'bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.12)] hover:bg-background active:bg-background'
                        : 'text-muted-foreground hover:bg-transparent hover:text-foreground active:bg-transparent'
                    )}>
                    <Icon
                      icon={DOMAIN_ICON[chip]}
                      aria-hidden
                      className={cn(
                        'shrink-0',
                        isInline ? 'size-3' : 'size-3.5',
                        isActive && 'text-primary'
                      )}
                    />
                    <span className="whitespace-nowrap">{DOMAIN_LABEL[chip]}</span>
                  </Button>
                )
              })}
            </div>
          </Glide.X>
          {/* 两侧渐隐：给出「还能继续横向滑」的暗示，否则被裁一半的卡片像是坏了 */}
          {scrollEdge.start ? (
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-y-0 left-0',
                isInline ? 'w-5' : 'w-8'
              )}
              style={{ backgroundImage: 'linear-gradient(to right, var(--popover), transparent)' }}
            />
          ) : null}
          {scrollEdge.end ? (
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-y-0 right-0',
                isInline ? 'w-5' : 'w-8'
              )}
              style={{ backgroundImage: 'linear-gradient(to left, var(--popover), transparent)' }}
            />
          ) : null}
        </div>

        <div
          ref={listRef}
          className={cn(
            'max-h-[min(42vh,20rem)] overflow-y-auto overscroll-y-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            isInline ? 'py-1 [scroll-padding-block:4px]' : 'py-2 [scroll-padding-block:8px]'
          )}>
          {flatHits.length === 0 ? (
            <p
              className={cn(
                'text-muted-foreground px-3 text-center',
                isInline ? 'py-3 text-xs' : 'py-6 text-[13px]'
              )}>
              {props.filter === 'file'
                ? '无匹配文件 · 支持 !排除 ext:rs path:src *通配'
                : '无匹配结果'}
            </p>
          ) : (
            groups.map(function (group) {
              return (
                <div
                  key={group.domain}
                  className={cn('last:mb-0', isInline ? 'mb-0.5' : 'mb-1')}>
                  <div
                    className={cn(
                      'text-muted-foreground font-semibold tracking-wide uppercase',
                      isInline ? 'px-2 pt-1 pb-0.5 text-[10px]' : 'px-3 pt-2 pb-1 text-[11px]'
                    )}>
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
                          // 整行淡色填充选中。灵动岛行更矮：图标井 24、标题 13、副标题 11
                          'relative h-auto w-full justify-start rounded-none text-left font-normal transition-colors duration-100',
                          isInline ? 'gap-2 px-2 py-1' : 'gap-3 px-3 py-2',
                          isActive
                            ? 'bg-foreground/[0.06] hover:bg-foreground/[0.06]'
                            : 'hover:bg-foreground/[0.04] active:bg-foreground/[0.08]',
                          // 分隔线从文字起点开始（左侧让开图标），最后一行不画
                          'before:bg-border/60 before:absolute before:bottom-0 before:h-px before:content-[""] last:before:hidden',
                          isInline ? 'before:right-2 before:left-10' : 'before:right-3 before:left-14'
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
                        <span
                          className={cn(
                            'bg-muted/70 text-muted-foreground flex shrink-0 items-center justify-center',
                            isInline ? 'size-6 rounded-md' : 'size-8 rounded-[10px]'
                          )}>
                          <Icon
                            icon={hit.icon ?? 'lucide:search'}
                            aria-hidden
                            className={isInline ? 'size-3.5' : 'size-4'}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block truncate font-medium',
                              isInline ? 'text-[13px] leading-none' : 'text-[15px] leading-tight'
                            )}>
                            {hit.title}
                          </span>
                          {hit.subtitle ? (
                            <span
                              className={cn(
                                'text-muted-foreground block truncate',
                                isInline
                                  ? 'mt-px text-[11px] leading-none'
                                  : 'mt-0.5 text-[13px] leading-tight'
                              )}>
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
