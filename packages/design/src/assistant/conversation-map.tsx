/**
 * Conversation map（对齐 assistant-ui `elements/conversation-map`）
 *
 * 会话左侧那条刻度尺：**一个回合一根**横线。静止时几乎看不见，只靠「长度差 + 深浅差」
 * 说话 —— 不画菱形、不画连线、不做缩略图。
 *
 * 三档刻度（元素页的 `data-in-view` / `data-active`）：
 * - 默认 `bg-foreground/15`：这一回合在屏幕外
 * - 在视口里 `bg-foreground/50`：这几段你此刻看得见
 * - 正在读 `bg-foreground/90` + `h-[3px]`：唯一加粗的一根，就是阅读锚
 *
 * 元素本体只负责「画」与无障碍：`activeId` / `visibleIds` / `onSelect` 全由宿主算
 * （见 `thread-user-ruler.aui.tsx`）。roving tabindex —— 只有当前那根 `tabIndex=0`，
 * Tab 进尺子只落一次；悬停出 tooltip 预览（正文不进静态 markup）；点击跳转到那一回合。
 *
 * 这一页的元素 `.md` 还没发布（`elements/conversation-map.md` 404），类名是从页面渲染出
 * 的 DOM 里还原的样式事实，结构与行为本仓自写。
 */
import { cn } from 'cn'
import type { ComponentProps } from 'react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/tooltip'
import { useAssistantLabels } from './labels'

interface ConversationMapTurn {
  /** 宿主用来定位消息（`scrollToUserMessage` 认这个 id） */
  id: string
  /** 刻度的无障碍名（预览里的第一行） */
  label: string
  /** 悬停预览的正文 */
  preview: string
}

// `onSelect` 是 DOM 的选区事件（ReactEventHandler），这里要的是 `onSelect(id)`，摘掉继承
interface ConversationMapProps extends Omit<ComponentProps<'nav'>, 'children' | 'onSelect'> {
  /** 一回合一根，顺序即会话顺序 */
  turns: readonly ConversationMapTurn[]
  /** 正在读的那根；`null` / 缺省表示还没有阅读锚（此时没有刻度占 Tab） */
  activeId?: string | null
  /** 整条消息落在视口内的回合 id */
  visibleIds?: readonly string[]
  /** 点击某根刻度：宿主拿 id 去滚动 */
  onSelect: (id: string) => void
  className?: string
}

/** 一根刻度：撑满可用高度、但不超过 14px，保证长会话里也挤得下 */
const TICK_CLASS =
  'group flex max-h-3.5 min-h-0 flex-1 items-center rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-foreground/20'
/** 刻度簇自己滚，但不带滚动条：窄窄一条 24px，露出滚动条反而更乱 */
const RAIL_CLASS = cn(
  'group/rail pointer-events-auto flex w-6 flex-col justify-center',
  'max-h-[min(70vh,22rem)] overflow-y-auto overscroll-y-contain',
  '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
)
/** 刻度本体：宽度 / 高度 / 颜色都走同一条缓动，悬停时只加长、不变色 */
const BAR_CLASS =
  'w-3 rounded-full transition-[width,height,background-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none'
/** 单根悬停：拉满到尺子宽度并加深 */
const BAR_HOVER =
  'group-hover:bg-foreground/70 group-focus-visible:bg-foreground/70 group-hover:w-6 group-focus-visible:w-6'
const BAR_IDLE = cn(BAR_CLASS, 'bg-foreground/15', BAR_HOVER)
const BAR_VISIBLE = cn(
  BAR_CLASS,
  'bg-foreground/50 group-hover:w-[18px] group-focus-within/rail:w-[18px]',
  BAR_HOVER
)
/** 当前那根：更高更实，整条尺子悬停 / 有焦点时拉满 */
const BAR_ACTIVE = cn(
  BAR_CLASS,
  'bg-foreground/90 h-[3px] group-hover:w-6 group-focus-within/rail:w-6'
)

function ConversationMap({
  turns,
  activeId,
  visibleIds,
  onSelect,
  className,
  ...props
}: ConversationMapProps) {
  const labels = useAssistantLabels()
  const visibleSet = new Set(visibleIds ?? [])

  return (
    <TooltipProvider delay={200}>
      <nav
        data-slot="conversation-map"
        aria-label={labels.conversationMap}
        className={cn(RAIL_CLASS, className)}
        {...props}>
        {turns.map(function (turn) {
          const active = turn.id === activeId
          const inView = active || visibleSet.has(turn.id)

          return (
            <Tooltip key={turn.id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    data-slot="conversation-map-tick"
                    data-active={active ? '' : undefined}
                    data-in-view={inView ? '' : undefined}
                    aria-current={active ? 'true' : undefined}
                    aria-label={turn.label}
                    tabIndex={active ? 0 : -1}
                    className={TICK_CLASS}
                    onClick={function () {
                      onSelect(turn.id)
                    }}>
                    <span
                      aria-hidden
                      className={active ? BAR_ACTIVE : inView ? BAR_VISIBLE : BAR_IDLE}
                    />
                  </button>
                }
              />
              <TooltipContent
                side="right"
                align="center"
                sideOffset={8}
                showArrow={false}
                className={cn(
                  'bg-popover text-popover-foreground',
                  'flex min-w-[11rem] max-w-[16rem] flex-col items-start gap-1 rounded-md px-3 py-2',
                  'text-left shadow-md'
                )}>
                <span className="text-muted-foreground text-xs leading-none font-medium tracking-wide tabular-nums">
                  {turn.label}
                </span>
                <span className="text-foreground/90 line-clamp-3 text-xs leading-snug tracking-tight">
                  {turn.preview}
                </span>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </nav>
    </TooltipProvider>
  )
}

export { ConversationMap }
export type { ConversationMapProps, ConversationMapTurn }
