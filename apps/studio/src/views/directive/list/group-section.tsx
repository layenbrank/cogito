import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ReactNode } from 'react'

import type { DirectiveGroup } from './types'

/**
 * 分组标题 + 可折叠内容。
 *
 * 开合不做高度动画：收起直接卸载子树，展开直接挂载。
 * 动效曾与网格卡片同帧抢主线程，性能优先时一律关掉。
 */

interface Props {
  group: DirectiveGroup
  isOpen: boolean
  variant: 'wall' | 'rail'
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

const VARIANT = {
  wall: {
    section: '',
    head: 'sticky top-0 z-10 rounded-xl px-5 py-2.5 bg-muted/70 backdrop-blur-md',
    body: 'pt-3',
    title: 'text-sm font-semibold tracking-tight text-foreground',
    count:
      'rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium text-muted-foreground shadow-xs'
  },
  /** 编排台左栏：与墙面同一套按钮壳，略收紧内边距；间隔交给父级 flex gap */
  rail: {
    section: '',
    head: 'sticky top-0 z-10 rounded-xl px-2.5 py-2 bg-muted/70 backdrop-blur-md',
    body: 'pt-2',
    title: 'text-xs font-semibold tracking-tight text-foreground',
    count:
      'rounded-full bg-background/80 px-1.5 py-0.5 text-xs font-medium text-muted-foreground shadow-xs'
  }
} as const

function DirectiveGroupSection(props: Props) {
  const { group, isOpen } = props
  const chrome = VARIANT[props.variant]
  const headId = `directive-group-${group.key}`

  return (
    <section
      className={chrome.section}
      aria-labelledby={headId}>
      <button
        id={headId}
        type="button"
        aria-expanded={isOpen}
        className={cn(
          'group/head flex w-full cursor-pointer items-center gap-2',
          chrome.head,
          chrome.title,
          'transition-colors hover:bg-accent-hover/80',
          'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
        )}
        onClick={function () {
          props.onOpenChange(!isOpen)
        }}>
        <span
          aria-hidden
          className={cn(
            'inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/80',
            !isOpen && '-rotate-90'
          )}>
          <Icon
            icon="mdi:chevron-down"
            className="size-4"
          />
        </span>
        <Icon
          icon={group.icon}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="truncate">{group.label}</span>
        <span className={cn('tabular-nums', chrome.count)}>{group.items.length}</span>
      </button>

      {isOpen ? <div className={chrome.body}>{props.children}</div> : null}
    </section>
  )
}

export { DirectiveGroupSection }
