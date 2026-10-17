import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { useCopyToClipboard } from '@i-thinking/design/hooks/use-copy-to-clipboard'
import type { ReactNode } from 'react'

import type { AsideSection } from './use-aside-panel.ts'

/**
 * 右栏的版式基件。
 *
 * 右栏段落多（运行 / 计划 / 变更 / 引用 / 工具调用 / 用量 / 额度 / 模型与权限 / 工作区 / 会话，共十段），
 * 每段的骨架长得一样，收在这里各段只写内容 —— 加一段不用抄一遍版式。
 */

interface AsideCardProps {
  /** 段落 id，同时是滚动定位锚点（见 `useAsidePanel().focus`） */
  id: AsideSection
  label: string
  /** 标题右侧的计数，如「变更（3）」 */
  count?: number
  /** 段头右侧的动作（如「撤销全部」） */
  action?: ReactNode
  children: ReactNode
}

export function AsideCard(props: AsideCardProps) {
  const { id, label, count, action, children } = props

  return (
    <section
      data-aside-section={id}
      className="border-border/70 bg-background flex flex-col gap-1.5 rounded-lg border px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium">
          {count === undefined ? label : `${label}（${count}）`}
        </span>
        {action}
      </div>
      {children}
    </section>
  )
}

interface AsideRowProps {
  label: string
  /** 值被截断时的完整内容（鼠标悬停可见） */
  title?: string
  children: ReactNode
}

export function AsideRow(props: AsideRowProps) {
  return (
    <div
      className="flex items-baseline justify-between gap-2 text-xs leading-5"
      title={props.title}>
      <span className="text-muted-foreground shrink-0">{props.label}</span>
      <span className="min-w-0 truncate text-end">{props.children}</span>
    </div>
  )
}

/** 空态 / 说明文案 */
export function AsideHint(props: { children: ReactNode }) {
  return <p className="text-muted-foreground text-xs leading-5">{props.children}</p>
}

interface AsideCopyProps {
  /** 要复制的内容；空值时不渲染 */
  value?: string
  /** 无障碍标签，如「复制工作区路径」 */
  label: string
}

export function AsideCopy(props: AsideCopyProps) {
  const { value, label } = props
  const { isCopied, copyToClipboard } = useCopyToClipboard()

  if (!value) return null

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="text-muted-foreground shrink-0"
      aria-label={label}
      title={label}
      onClick={function () {
        copyToClipboard(value)
      }}>
      {isCopied ? <Icon icon="lucide:check" /> : <Icon icon="lucide:copy" />}
    </Button>
  )
}
