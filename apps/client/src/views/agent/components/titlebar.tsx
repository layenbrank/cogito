/**
 * Agent 窗口标题栏：复用 Caption（拖拽 + 窗口键）。
 *
 * 左侧仅品牌；右侧新建与布局图标贴窗控。会话标题仍在中栏 Head。
 */
import { Caption } from '@/components/caption'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'

import { TitlebarActions, type TitlebarLayoutState } from '@/views/agent/components/titlebar-actions'

interface TitlebarProps {
  className?: string
  /** 右侧扩展（须自带 data-region="false"）；如委派入口 */
  actions?: ReactNode
  /** 聊页传入时显示布局开合图标；设置页可省略 */
  layout?: TitlebarLayoutState
}

function AgentTitlebar(props: TitlebarProps) {
  return (
    <Caption
      className={clsx(
        'border-border bg-background text-foreground border-b',
        props.className
      )}
      begin={
        <div
          data-region="false"
          className="flex min-w-0 items-center gap-1.5 pl-0.5">
          <span className="text-foreground shrink-0 pl-1 text-sm font-semibold tracking-tight">
            cogito
          </span>
        </div>
      }
      final={
        <TitlebarActions
          layout={props.layout}
          extra={props.actions}
        />
      }
    />
  )
}

export { AgentTitlebar }
export type { TitlebarProps }
