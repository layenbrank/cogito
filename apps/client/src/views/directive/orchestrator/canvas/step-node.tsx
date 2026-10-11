import { Badge } from '@i-thinking/design/components/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { Icon } from '@iconify/react/offline'
import type { ReactNode } from 'react'

import { findStepKind } from '@/views/directive/model/step-utils.ts'
import type { Step } from '@/views/directive/model/types.ts'

const KIND_LABEL: Record<string, string> = {
  action: '动作',
  if: '条件',
  repeat: '循环',
  parallel: '并行',
  steps: '步骤块'
}

interface StepNodeProps {
  step: Step
  depth: number
  isSelected: boolean
  showConnector: boolean
  onSelect: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDuplicate: () => void
  onRemove: () => void
  children?: ReactNode
}

function findStepHint(step: Step): string {
  if ('action' in step) {
    const keys = step.params ? Object.keys(step.params) : []
    if (step.save_to) return `→ ${step.save_to}`
    if (keys.length > 0) return `${keys.length} 个参数`
    return '未配置参数'
  }
  if ('if' in step) {
    const thenCount = step.then.length
    const elseCount = step.else?.length ?? 0
    return `then ${thenCount} · else ${elseCount}`
  }
  if ('repeat' in step) {
    if (step.repeat.count != null) return `count ${step.repeat.count}`
    if (step.repeat.each) return `each ${step.repeat.each}`
    return '未设置循环'
  }
  if ('parallel' in step) return `${step.parallel.length} 条并行`
  if ('steps' in step) return `${step.steps.length} 个子步骤`
  return ''
}

function StepNode(props: StepNodeProps) {
  const kind = findStepKind(props.step)
  const title =
    kind === 'action' && 'action' in props.step
      ? props.step.action
      : `${KIND_LABEL[kind]} · ${props.step.id ?? '—'}`
  const hint = findStepHint(props.step)

  return (
    <div className="relative">
      {props.showConnector ? (
        <div
          aria-hidden
          className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 -translate-y-full bg-border"
        />
      ) : null}
      <div
        role="button"
        tabIndex={0}
        onClick={props.onSelect}
        onKeyDown={function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            props.onSelect()
          }
        }}
        className={
          'group flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-left text-sm shadow-sm transition-colors ' +
          (props.isSelected
            ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
            : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40')
        }
        style={{ marginLeft: props.depth * 16 }}>
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
          <Icon
            icon={
              kind === 'action'
                ? 'lucide:zap'
                : kind === 'if'
                  ? 'lucide:git-branch'
                  : kind === 'repeat'
                    ? 'lucide:repeat'
                    : kind === 'parallel'
                      ? 'lucide:layers'
                      : 'lucide:folder-tree'
            }
            className="size-4"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{KIND_LABEL[kind]}</Badge>
            {props.step.id ? (
              <span className="truncate text-xs text-muted-foreground">{props.step.id}</span>
            ) : null}
          </div>
          <p className="mt-1 truncate font-medium">{title}</p>
          {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md opacity-70 hover:bg-muted hover:opacity-100"
            aria-label="步骤菜单"
            onClick={function (event) {
              event.stopPropagation()
            }}>
            <Icon
              icon="lucide:more-horizontal"
              className="size-4"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={props.onMoveUp}>
              <Icon
                icon="lucide:arrow-up"
                className="size-4"
              />
              上移
            </DropdownMenuItem>
            <DropdownMenuItem onClick={props.onMoveDown}>
              <Icon
                icon="lucide:arrow-down"
                className="size-4"
              />
              下移
            </DropdownMenuItem>
            <DropdownMenuItem onClick={props.onDuplicate}>
              <Icon
                icon="lucide:copy"
                className="size-4"
              />
              复制
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={props.onRemove}>
              <Icon
                icon="lucide:trash-2"
                className="size-4"
              />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {props.children ? <div className="mt-4 space-y-4 pl-2">{props.children}</div> : null}
    </div>
  )
}

export { StepNode }
