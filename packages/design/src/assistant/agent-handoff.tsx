/**
 * Handoff（对齐 assistant-ui `elements/agent-handoff`）
 *
 * 控制权从一个 agent 交到另一个 agent 的那一刻：谁交的、交给谁、为什么、带走了什么。
 *
 * 全部展示性，宿主决定何时算交接：
 * - `settled=false`：箭头与「交给谁」那颗药丸是主色，读作「正在交接」；`from` 保持全不透明；
 * - `settled=true`：`from` 调暗、箭头转灰、`to` 换成中性 `field` 药丸 —— 它已经是当前说话人。
 * - `carried` 必填：要「没有带走任何东西」就传空数组，那时整段不渲染
 *   （不是渲染一个空标题）。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps } from 'react'

import { field, mono, paper } from './elements/surfaces'

interface AgentHandoffProps extends Omit<ComponentProps<'div'>, 'children'> {
  from: string
  to: string
  reason: string
  carried: readonly string[]
  settled: boolean
}

const TRANSITION = 'transition-colors duration-500 ease-out motion-reduce:transition-none'

function AgentHandoff(props: AgentHandoffProps) {
  const { from, to, reason, carried, settled, className, ...rest } = props

  return (
    <div
      data-slot="agent-handoff"
      data-settled={settled ? 'true' : 'false'}
      className={cn(paper, 'flex w-full flex-col gap-2 rounded-2xl px-3 py-2.5', className)}
      {...rest}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span
          data-slot="agent-handoff-from"
          className={cn(
            field,
            TRANSITION,
            'max-w-36 truncate rounded-full px-2 py-0.5 text-xs text-foreground/90',
            settled ? 'opacity-60' : 'opacity-100'
          )}>
          {from}
        </span>
        <Icon
          icon="lucide:arrow-right"
          aria-hidden
          className={cn(
            'size-3.5 shrink-0',
            TRANSITION,
            settled ? 'text-muted-foreground' : 'text-primary'
          )}
        />
        <span
          data-slot="agent-handoff-to"
          className={cn(
            TRANSITION,
            'max-w-48 truncate rounded-full px-2 py-0.5 text-xs font-medium',
            settled ? cn(field, 'text-foreground/90') : 'bg-primary/12 text-primary'
          )}>
          {to}
        </span>
        <span className="sr-only">
          {settled ? '已完成交接' : '正在交接'}：{from} → {to}
        </span>
      </div>

      <p
        data-slot="agent-handoff-reason"
        className="text-muted-foreground text-xs leading-relaxed wrap-break-word">
        {reason}
      </p>

      {carried.length > 0 ? (
        <div
          data-slot="agent-handoff-carried"
          className="flex flex-col gap-1">
          <span className={cn(mono, 'text-[0.6875rem] tracking-wide')}>交接上下文</span>
          <ul className="flex flex-col gap-0.5">
            {carried.map(function (item, index) {
              return (
                <li
                  key={`${item}-${index}`}
                  className="text-muted-foreground flex min-w-0 items-start gap-1.5 text-xs leading-relaxed">
                  <Icon
                    icon="lucide:corner-down-right"
                    aria-hidden
                    className="mt-0.5 size-3 shrink-0 opacity-60"
                  />
                  <span className="min-w-0 wrap-break-word">{item}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export { AgentHandoff }
export type { AgentHandoffProps }
