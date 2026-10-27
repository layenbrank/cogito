import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Caption, type CaptionProps } from '@/components/caption/caption'
import { useShowsTileSession } from '@/features/magnetic-tile/session-bar'

/**
 * 窗口容器：Caption + 内容区 + 可选底栏。
 * 根透明（圆角外沿可透 mica）；内容槽铺 `bg-background` 实底，主工作区不透壁纸。
 * 纵向 flex 撑满窗口，子节点不必再写 `100vh`。
 */

interface DecorationsProps {
  children: ReactNode
  className?: string
  /** 顶栏标题；`begin` 优先，两者都没传则顶栏只有窗口键 */
  summary?: string
  /** 顶栏左侧主区域 */
  begin?: ReactNode
  /** 顶栏右侧扩展区域（窗口键左侧），与 `begin` 对立 */
  final?: ReactNode
  /** 窗口键开关；不传为全开 */
  controls?: CaptionProps['controls']
  /** 底栏区域；不传则不渲染 */
  section?: ReactNode
  /** 覆盖底栏默认样式（如 IDE 状态栏需更密、全宽） */
  sectionClassName?: string
  /** 内容区是否由外壳统一滚动；内部已有滚动区时传 false */
  scrollable?: boolean
}

function findCaptionBegin(
  begin: ReactNode | undefined,
  summary: string | undefined,
  showsSession: boolean
): ReactNode {
  if (begin) return begin
  // 会话切换已经写出当前应用，纯磁贴名不再重复
  if (showsSession || !summary) return null
  return <span className="truncate px-1 text-sm font-medium">{summary}</span>
}

function Decorations(props: DecorationsProps) {
  const scrollable = props.scrollable ?? true
  const showsSession = useShowsTileSession()

  return (
    <div
      className={cn(
        'flex h-screen w-screen flex-col overflow-hidden bg-transparent text-foreground',
        props.className
      )}>
      <Caption
        begin={findCaptionBegin(props.begin, props.summary, showsSession)}
        final={props.final}
        controls={props.controls}
      />
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col bg-background',
          scrollable ? 'overflow-auto' : 'overflow-hidden'
        )}>
        {props.children}
      </div>
      {props.section ? (
        <section
          className={cn(
            'flex shrink-0 justify-end gap-2.5 border-t border-border bg-background px-5 py-3',
            props.sectionClassName
          )}>
          {props.section}
        </section>
      ) : null}
    </div>
  )
}

export { Decorations }
export type { DecorationsProps }
