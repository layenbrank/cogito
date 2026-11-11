/**
 * Tool call（对齐 assistant-ui `elements/tool-call`）
 *
 * 一次工具调用折成**一行**：箭头 + 说法（跑着是「正在读取文件」，落地后换成「读取文件」）
 * + 主要参数的等宽芯片 + 右端状态（跑完对勾 / 失败叉 / 等人处理警示）。
 * 点开是一块 `field` 表面：`请求`（原始参数）—— 发丝线 —— `结果`。
 *
 * 与 `tool-fallback.aui.tsx` 的关系：那边 `ToolFallback.Trigger` 的行**直接复用**本文件的
 * `ToolCallRow`。本仓工具卡的展开区要放 diff / 终端正文 / 文件树，元素那套「请求 + 结果」
 * 单面板包不住，所以只有行（行就是这个元素的签名）抽出来共用，面板留给各自的卡。
 *
 * 元素本体是收费产物，结构 / 行为 / 无障碍按官网渲染出的 DOM 与 `.md` 契约自写：
 * - 两种说法叠在同一格栅里交叉淡出（`opacity` + `blur`），宽度取两者较宽的那个，不跳；
 * - 隐藏的那一半 `aria-hidden`，读屏只念当前说法；
 * - 面板只在 `open` 时挂载（元素页也是「mounted only while open」）。
 *
 * 本仓补的四处（元素页没有）：`waiting`（审批 / 补充信息等人处理）、`cancelled`、
 * `duration`（右端耗时）、`children`（面板里追加文件树 / 代码块）。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ReactNode } from 'react'

import { field, mono } from './elements/surfaces'
import { useAssistantLabels } from './labels'

interface ToolCallRowProps {
  /** 落地后的说法：`读取文件` */
  label: string
  /** 跑着的说法：`正在读取文件` */
  activeLabel: string
  /** 主要参数：等宽芯片（没有就不出现） */
  query?: string
  running?: boolean
  /** 执行失败（不是用户取消）：右端换叉 */
  failed?: boolean
  /** 等人处理（审批 / 补充信息） */
  waiting?: boolean
  /** 用户取消：说法划掉、右端禁止符 */
  cancelled?: boolean
  /** 右端状态前面那一小块（耗时） */
  trailing?: ReactNode
}

interface ToolCallProps extends Omit<ToolCallRowProps, 'trailing'> {
  /** 原始请求（参数文本）：空串不渲染这一块 */
  request?: string
  /** 结果文本：空串不渲染这一块 */
  result?: string
  /** 右端耗时 */
  duration?: ReactNode
  /** 面板是否展开（受控，元素本身不留内部状态） */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 面板里追加的内容（文件树 / 代码块 / 跳转按钮这类） */
  children?: ReactNode
  className?: string
}

/**
 * 右端状态。元素页在跑着的时候把那格留空（靠说法 shimmer 表达），
 * 本仓给一个转圈 —— 一行行扫过去时，动的东西比闪的文字更容易抓住。
 */
function findStatusIcon(props: ToolCallRowProps): { icon: string; className: string } {
  if (props.cancelled) return { icon: 'lucide:ban', className: 'text-muted-foreground' }
  if (props.failed) return { icon: 'lucide:x', className: 'text-destructive' }
  if (props.waiting) return { icon: 'lucide:circle-alert', className: 'text-warning' }
  if (props.running) {
    return {
      icon: 'lucide:loader-circle',
      className:
        'text-muted-foreground animate-spin [animation-duration:0.9s] motion-reduce:animate-none'
    }
  }
  return {
    icon: 'lucide:check',
    className: 'text-success animate-in fade-in zoom-in-90 duration-200'
  }
}

/** 一行工具的心跳：箭头 / 说法 / 参数芯片 / 右端状态。调用方负责包一层可点的按钮 */
function ToolCallRow(props: ToolCallRowProps) {
  const running = props.running === true
  const status = findStatusIcon(props)
  // 两种说法叠在同一格：宽度取较宽的那个，切换时不跳
  const base =
    'col-start-1 row-start-1 flex w-max items-center gap-1.5 leading-none transition-[opacity,filter] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none'
  const hidden = 'pointer-events-none select-none opacity-0 blur-[2px]'
  const shown = 'opacity-100 blur-none'

  return (
    <>
      <Icon
        icon="lucide:chevron-right"
        data-slot="tool-call-chevron"
        aria-hidden
        className="size-3.5 shrink-0 opacity-60 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-open/trigger:rotate-90 group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none"
      />
      <span
        data-slot="tool-call-label"
        data-state={running ? 'running' : 'settled'}
        className={cn(
          'grid shrink-0 text-start leading-none whitespace-nowrap',
          props.cancelled && 'text-muted-foreground line-through'
        )}>
        <span
          aria-hidden={running || undefined}
          className={cn(base, running ? hidden : shown)}>
          {props.label}
        </span>
        <span
          aria-hidden={running ? undefined : true}
          className={cn(
            base,
            running ? shown : hidden,
            running && 'shimmer shimmer-contrast motion-reduce:animate-none'
          )}>
          {props.activeLabel}
        </span>
      </span>
      {props.query ? (
        <span
          data-slot="tool-call-query"
          title={props.query}
          className={cn(
            mono,
            'bg-foreground/[0.06] text-foreground/70 min-w-0 truncate rounded-md px-1.5 py-0.5'
          )}>
          {props.query}
        </span>
      ) : null}
      <span
        data-slot="tool-call-status"
        className="ms-auto flex shrink-0 items-center justify-end gap-1.5">
        {props.trailing}
        <Icon
          icon={status.icon}
          aria-hidden
          className={cn('size-3.5 shrink-0', status.className)}
        />
      </span>
    </>
  )
}

/** 面板里的一块：等宽小标题 + 正文（请求是等宽原文，结果按正文排） */
function ToolCallBlock(props: {
  slot: string
  title: string
  text: string
  tone: 'request' | 'result'
}) {
  return (
    <div
      data-slot={props.slot}
      className="px-3.5 pt-2.5 pb-2">
      <p
        data-slot={props.slot + '-title'}
        className={cn(mono, 'mb-1')}>
        {props.title}
      </p>
      <p
        className={cn(
          'break-words whitespace-pre-wrap',
          props.tone === 'request'
            ? 'text-muted-foreground font-mono'
            : 'text-foreground/90 leading-relaxed'
        )}>
        {props.text}
      </p>
    </div>
  )
}

function ToolCall({
  label,
  activeLabel,
  query,
  request,
  result,
  running,
  failed,
  waiting,
  cancelled,
  duration,
  open,
  onOpenChange,
  children,
  className
}: ToolCallProps) {
  const labels = useAssistantLabels()
  const hasRequest = Boolean(request)
  const hasResult = Boolean(result)

  return (
    <div
      data-slot="tool-call"
      data-open={open ? '' : undefined}
      data-state={cancelled ? 'cancelled' : failed ? 'failed' : running ? 'running' : 'settled'}
      className={cn('w-full', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={function () {
          onOpenChange(!open)
        }}
        className="group/trigger text-muted-foreground hover:text-foreground/90 flex w-full items-center gap-2 rounded-md text-sm outline-hidden transition-colors">
        <ToolCallRow
          label={label}
          activeLabel={activeLabel}
          query={query}
          running={running}
          failed={failed}
          waiting={waiting}
          cancelled={cancelled}
          trailing={duration}
        />
      </button>

      {open ? (
        <div
          data-slot="tool-call-panel"
          className={cn(field, 'mt-2 overflow-hidden rounded-2xl text-xs')}>
          {hasRequest ? (
            <ToolCallBlock
              slot="tool-call-request"
              title={labels.toolCallRequest}
              text={request ?? ''}
              tone="request"
            />
          ) : null}
          {hasRequest && hasResult ? (
            <div
              data-slot="tool-call-divider"
              aria-hidden
              className="bg-foreground/[0.06] mx-3.5 h-px"
            />
          ) : null}
          {hasResult ? (
            <ToolCallBlock
              slot="tool-call-result"
              title={labels.toolCallResult}
              text={result ?? ''}
              tone="result"
            />
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  )
}

export { ToolCall, ToolCallRow }
export type { ToolCallProps, ToolCallRowProps }
