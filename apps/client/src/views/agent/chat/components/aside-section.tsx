/**
 * 右栏分区卡：标题 14px / 正文 13px，12px 圆角 + 细描边。
 *
 * 详情（aside-busy）与上下文（aside-context）共用同一套卡片，避免两个面板各写一种
 * 间距与字号 —— 右栏窄，样式一旦不统一，切换页签就像换了个人做的。
 */
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'

interface AsideSectionProps {
  icon: string
  /** 图标点缀色；缺省跟随 muted */
  iconClass?: string
  title: string
  meta?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}

function AsideSection(props: AsideSectionProps) {
  return (
    <section
      className={clsx(
        'border-border/60 bg-card flex flex-col gap-2.5 rounded-xl border p-3 shadow-xs',
        props.className
      )}>
      <div className="flex items-center gap-2">
        <Icon
          icon={props.icon}
          className={clsx('size-4 shrink-0', props.iconClass ?? 'text-muted-foreground')}
        />
        <span className="text-foreground min-w-0 truncate text-sm font-semibold">
          {props.title}
        </span>
        {props.meta ? (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{props.meta}</span>
        ) : null}
        <span className="ms-auto flex shrink-0 items-center gap-1">{props.action}</span>
      </div>
      {props.children}
    </section>
  )
}

export { AsideSection }
export type { AsideSectionProps }
