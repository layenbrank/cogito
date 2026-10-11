import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Caption, type CaptionProps } from '@/components/caption/caption'

/**
 * 无边框窗口的通用外壳（容器）：顶栏装饰（Caption）+ 内容区 + 可选底栏。
 * 对应 Tauri `decorations: false` 后的自绘窗口装饰壳。
 *
 * 两种形态：
 * - `framed`（默认）：透明窗内层圆角卡片（磁贴窗）—— 卡片承担可见面，内容区不透明；
 * - `framed={false}`：不画卡片，内容区透明（原生 mica / 亚克力透出来），供主窗口这类
 *   自带窗口材质的场景用 —— 但容器职责不变：**它负责把内容撑满窗口并给出纵向 flex 列**，
 *   子元素不再各自 `height: 100vh`。
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
  /** 内容区是否由外壳统一滚动；内部已有滚动区时传 false */
  scrollable?: boolean
  /** 透明窗口下渲染内层圆角卡片；窗口自带材质（mica 等）时传 false */
  framed?: boolean
}

function Decorations(props: DecorationsProps) {
  const scrollable = props.scrollable ?? true
  const framed = props.framed ?? true
  const begin =
    props.begin ??
    (props.summary ? (
      <span className="truncate px-1 text-sm font-medium">{props.summary}</span>
    ) : null)

  return (
    <div className="h-screen w-screen bg-transparent">
      <div
        className={cn(
          'flex h-full w-full flex-col overflow-hidden text-foreground',
          framed && 'rounded-xl border border-border bg-card shadow-lg',
          props.className
        )}>
        <Caption
          begin={begin}
          final={props.final}
          controls={props.controls}
          framed={framed}
          className={cn(framed && 'border-b border-border/60')}
        />
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            framed ? 'bg-background' : 'bg-transparent',
            scrollable ? 'overflow-auto' : 'overflow-hidden'
          )}>
          {props.children}
        </div>
        {props.section ? (
          <section className="flex shrink-0 justify-end gap-2.5 border-t border-border/60 bg-card px-5 py-3">
            {props.section}
          </section>
        ) : null}
      </div>
    </div>
  )
}

export { Decorations }
export type { DecorationsProps }
