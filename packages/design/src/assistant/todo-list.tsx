/**
 * 任务执行清单：带状态的步骤列表（对齐 assistant-ui `todo-list` 元素）。
 *
 * 三态：待办 / 进行中 / 已完成。goose 的 `plan` 事件自带这套状态；
 * 计划草稿一律按「待办」渲染 —— 两种来源共用同一个清单形态，
 * 右侧不再出现「计划 markdown 源码」。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useState } from 'react'

type TodoStatus = 'pending' | 'in_progress' | 'completed'

interface TodoItem {
  content: string
  status?: TodoStatus
}

const STATUS_ICON: Record<TodoStatus, { icon: string; className: string }> = {
  pending: { icon: 'lucide:circle', className: 'text-muted-foreground' },
  in_progress: { icon: 'lucide:loader-circle', className: 'text-primary animate-spin' },
  completed: { icon: 'lucide:circle-check', className: 'text-success' }
}

function TodoList(props: { items: readonly TodoItem[]; className?: string }) {
  /** 长条目展开用的是下标集合：计划条目不带稳定 id */
  const [expanded, updateExpanded] = useState<ReadonlySet<number>>(new Set())

  function toggle(index: number) {
    updateExpanded(function (prev) {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <ol
      data-slot="todo-list"
      className={cn('flex flex-col gap-1', props.className)}>
      {props.items.map(function (item, index) {
        const status = item.status ?? 'pending'
        const icon = STATUS_ICON[status]
        const isExpanded = expanded.has(index)
        return (
          <li
            key={`${index}-${item.content}`}
            data-status={status}
            title={isExpanded ? '点击收起' : item.content}
            onClick={function () {
              toggle(index)
            }}
            className="hover:bg-muted/50 flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-xs leading-relaxed transition-colors">
            <Icon
              icon={icon.icon}
              className={cn('mt-1 size-3.5 shrink-0', icon.className)}
            />
            <span
              className={cn(
                'min-w-0 flex-1 break-words',
                status === 'completed'
                  ? 'text-muted-foreground line-through'
                  : 'text-foreground',
                !isExpanded && 'line-clamp-2'
              )}>
              {item.content}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export { TodoList }
export type { TodoItem, TodoStatus }
