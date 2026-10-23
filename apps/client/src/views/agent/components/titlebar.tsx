/**
 * Agent 窗口标题栏：复用通用 Caption（拖拽 + 窗口键）。
 *
 * 对齐 Qoder：设置页「返回」在左栏，不占 Caption；会话标题在中栏 Head。
 * 这里只放品牌与可选右侧动作（如委派）。
 */
import { Caption } from '@/components/caption'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'

interface TitlebarProps {
  className?: string
  /** 右侧扩展（须自带 data-region="false"）；如委派入口 */
  actions?: ReactNode
}

function AgentTitlebar(props: TitlebarProps) {
  return (
    <Caption
      className={clsx(
        'border-border bg-background text-foreground border-b',
        props.className
      )}
      begin={
        <span className="text-foreground shrink-0 pl-1 text-sm font-semibold tracking-tight">
          cogito
        </span>
      }
      final={props.actions}
    />
  )
}

export { AgentTitlebar }
export type { TitlebarProps }
