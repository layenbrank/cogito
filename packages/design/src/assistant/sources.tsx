import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps, ReactNode } from 'react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/collapsible'

export type SourcesProps = ComponentProps<typeof Collapsible>

/** 折叠条形态（旧版）：回答末尾「引用 N 个来源」+ 竖排列表。 */
export const Sources = ({ className, ...props }: SourcesProps) => (
  <Collapsible
    className={cn('not-prose mb-4 text-primary text-xs', className)}
    {...props}
  />
)

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number
}

export const SourcesTrigger = ({ className, count, children, ...props }: SourcesTriggerProps) => (
  <CollapsibleTrigger
    className={cn('flex items-center gap-2', className)}
    {...props}>
    {children ?? (
      <>
        <p className="font-medium">Used {count} sources</p>
        <Icon
          icon="lucide:chevron-down"
          className="h-4 w-4"
        />
      </>
    )}
  </CollapsibleTrigger>
)

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>

export const SourcesContent = ({ className, ...props }: SourcesContentProps) => (
  <CollapsibleContent
    className={cn('mt-3 flex w-fit flex-col gap-2 outline-none', className)}
    {...props}
  />
)

export type SourceProps = ComponentProps<'a'>

export const Source = ({ href, title, children, ...props }: SourceProps) => (
  <a
    className="flex items-center gap-2"
    href={href}
    rel="noreferrer"
    target="_blank"
    {...props}>
    {children ?? (
      <>
        <Icon
          icon="lucide:book"
          className="h-4 w-4"
        />
        <span className="block font-medium">{title}</span>
      </>
    )}
  </a>
)

/* -------------------------------------------------------------------------- */
/* 芯片形态（对齐 assistant-ui `elements/sources`）                            */
/* -------------------------------------------------------------------------- */

type SourceVariant = 'outline' | 'ghost' | 'muted'

interface SourceChipProps extends Omit<ComponentProps<'a'>, 'title'> {
  href: string
  /** 站点名 / 文档名；列表里截断，完整值交给 `title` 提示 */
  title: string
  /** 描边（默认）/ 无底 / 灰底 */
  variant?: SourceVariant
  /** 已知站点的 iconify 名（如 `lucide:github`）；不传就用标题首字母方块 */
  icon?: string
  /** 自定义图标节点，优先于 `icon` 与首字母 */
  iconNode?: ReactNode
}

const CHIP_BASE =
  'inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium outline-hidden transition-colors [&_svg]:size-3 [&_svg]:shrink-0 focus-visible:ring-1 focus-visible:ring-ring/50 motion-reduce:transition-none'

const CHIP_VARIANTS: Record<SourceVariant, string> = {
  outline:
    'border border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
  ghost:
    'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
  muted: 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
}

/** 首字母：中文取第一个字，英文/域名取首字母大写；空串给一个中性符号 */
function sourceInitial(title: string, href: string): string {
  const source = title.trim() || href.replace(/^https?:\/\//, '').split('/')[0] || ''
  const first = source.trim().charAt(0)
  return first ? first.toUpperCase() : '·'
}

function SourceChip({
  href,
  title,
  variant = 'outline',
  icon,
  iconNode,
  className,
  children,
  ...props
}: SourceChipProps) {
  const marker = iconNode ?? (
    <span
      data-slot="source-icon-fallback"
      aria-hidden
      className="bg-muted flex size-3 shrink-0 items-center justify-center rounded-sm text-xs leading-none font-medium">
      {icon ? <Icon icon={icon} /> : sourceInitial(title, href)}
    </span>
  )

  return (
    <a
      data-slot="source"
      href={href}
      title={title}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(CHIP_BASE, CHIP_VARIANTS[variant], className)}
      {...props}>
      {children ?? (
        <>
          {marker}
          <span className="max-w-[9.5rem] truncate">{title}</span>
        </>
      )}
    </a>
  )
}

interface SourceChipsProps extends ComponentProps<'div'> {
  sources: readonly { title: string; href: string; icon?: string }[]
  variant?: SourceVariant
}

/** 一行可换行的来源芯片：卡片里只占一两行，不再撑成竖排列表 */
function SourceChips({ sources, variant = 'outline', className, ...props }: SourceChipsProps) {
  if (sources.length === 0) return null
  return (
    <div
      data-slot="source-chips"
      className={cn('flex flex-wrap items-center gap-2', className)}
      {...props}>
      {sources.map(function (source) {
        return (
          <SourceChip
            key={source.href}
            href={source.href}
            title={source.title}
            icon={source.icon}
            variant={variant}
          />
        )
      })}
    </div>
  )
}

export { SourceChip, SourceChips }
export type { SourceChipProps, SourceChipsProps, SourceVariant }
