/**
 * Agent status（对齐 assistant-ui `elements/agent-status`）
 *
 * 一颗药丸回答两件事：**在干什么** + **多久了**。
 * - 前导指示：`done` 勾、`failed` 叉、`working` 实心呼吸点、`waiting` 空心点
 *   （形状与动效都不同，不只靠颜色区分）；
 * - `label` 变化时交叉淡入（按内容 key 重挂），不做位移动画；
 * - `elapsed` 只在 working / waiting 时出现；
 * - 状态另有一份 `sr-only` 文本，读屏不依赖点的颜色。
 *
 * 元素是**受控展示**：状态、文案、耗时都由宿主给（官网 runtime 版读 `s.thread.tasks`，
 * 本仓没有 task 数据源，只用 props 版）。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps, ReactNode } from 'react'

import { mono } from './elements/surfaces'

type AgentState = 'working' | 'waiting' | 'done' | 'failed'

const STATE_LABEL: Record<AgentState, string> = {
  working: '进行中',
  waiting: '等待中',
  done: '已完成',
  failed: '失败'
}

const INDICATOR: Record<AgentState, ReactNode> = {
  working: (
    <span className="bg-primary size-2 animate-pulse rounded-full motion-reduce:animate-none" />
  ),
  waiting: <span className="border-muted-foreground size-2 rounded-full border" />,
  done: (
    <Icon
      icon="lucide:check"
      className="text-success size-3.5"
    />
  ),
  failed: (
    <Icon
      icon="lucide:x"
      className="text-destructive size-3.5"
    />
  )
}

interface AgentStatusProps extends Omit<ComponentProps<'span'>, 'children'> {
  state: AgentState
  label: string
  /** 只在 working / waiting 时展示 */
  elapsed?: string
  /** 替换右侧装饰图标（例如展开某处的 chevron） */
  trailing?: ReactNode
}

function AgentStatus(props: AgentStatusProps) {
  const { state, label, elapsed, trailing, className, ...rest } = props
  const showElapsed = Boolean(elapsed) && (state === 'working' || state === 'waiting')

  return (
    <span
      data-slot="agent-status"
      data-state={state}
      role="status"
      aria-live="polite"
      className={cn(
        'border-border/60 bg-background text-foreground/90 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs',
        className
      )}
      {...rest}>
      <span
        aria-hidden
        className="flex size-3.5 shrink-0 items-center justify-center">
        {INDICATOR[state]}
      </span>
      <span className="sr-only">{STATE_LABEL[state]}</span>
      <span
        key={label}
        data-slot="agent-status-label"
        className="animate-in fade-in min-w-0 truncate duration-200 motion-reduce:animate-none">
        {label}
      </span>
      {showElapsed ? (
        <span
          data-slot="agent-status-elapsed"
          className={cn(mono, 'shrink-0 tabular-nums')}>
          {elapsed}
        </span>
      ) : null}
      <span
        aria-hidden
        className="text-muted-foreground flex size-3.5 shrink-0 items-center justify-center">
        {trailing ?? (
          <Icon
            icon={state === 'working' || state === 'waiting' ? 'lucide:pause' : 'lucide:rotate-ccw'}
            className="size-3"
          />
        )}
      </span>
    </span>
  )
}

export { AgentStatus }
export type { AgentState, AgentStatusProps }
