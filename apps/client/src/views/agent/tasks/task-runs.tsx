/**
 * 执行记录：任务详情里的「这一条任务的记录」与页面级「全部记录」共用。
 *
 * 记录来自 `automation_run`（本机 / goose 手动触发没有本地记录时会直接提示）。
 * 状态筛选在纯函数里做（`model.filterRuns`），这里只管展开与「再跑一次」。
 *
 * 版式与右栏其它页签一致：筛选是浅底分段控件（12px），行是 `rounded-lg` 的
 * 描边卡，时间 12px 等宽数字、状态胶囊、元信息 12px；动作用次级文字按钮，
 * 收在行底 —— 292px 宽下和元信息抢同一行会把「耗时」挤没。
 */
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import { useMemo, useState } from 'react'

import type { Automation, AutomationRun } from '@/shared/ipc/specs/automation'
import { DICT_TYPE } from '@/shared/ipc/specs/dict'
import { useDictStore } from '@/stores/dict'
import { formatTime } from '@/views/knowledge/lib/format.ts'
import {
  RUN_STATUS,
  filterRuns,
  findPhaseLabel,
  findRunDuration,
  formatDuration,
  type RunFilter
} from './model'
import { TaskStatusPill } from './task-status-pill'

interface TaskRunsProps {
  runs: AutomationRun[]
  /** 全部记录视图：每条要标出是哪个任务 */
  tasks?: Automation[]
  /** 不传 = 不能重跑（例如 goose 任务在本地没有执行入口） */
  onRerun?: (automationId: string) => void
  /** 打开对应落库会话（侧栏「自动化」分组同源） */
  onOpenSession?: (sessionId: string) => void
  /** 正在跑的任务 id 集合：按钮显示「执行中」 */
  running?: Record<string, boolean>
}

const FILTERS: readonly { key: RunFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'succeeded', label: '成功' },
  { key: 'failed', label: '失败' },
  { key: 'running', label: '执行中' }
]

function findStatusTone(status: string): 'ok' | 'fail' | 'running' | 'idle' {
  if (status === RUN_STATUS.SUCCEEDED) return 'ok'
  if (status === RUN_STATUS.FAILED) return 'fail'
  if (status === RUN_STATUS.RUNNING) return 'running'
  return 'idle'
}

/** 行内文字按钮：统一一档字号与色阶（hover 才提亮） */
const LINK_BUTTON =
  'text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50'

function TaskRuns(props: TaskRunsProps) {
  const [filter, updateFilter] = useState<RunFilter>('all')
  /** 展开过输出的记录 id；默认收起，避免长输出把列表撑爆 */
  const [expanded, updateExpanded] = useState<Record<string, boolean>>({})
  const findLabel = useDictStore(function (state) {
    return state.findLabel
  })

  const visible = useMemo(
    function () {
      return filterRuns(props.runs, filter)
    },
    [props.runs, filter]
  )

  /** 一趟统计四个计数：每个筛选按钮各扫一遍列表是白花的时间 */
  const counts = useMemo(
    function () {
      const result: Record<RunFilter, number> = {
        all: props.runs.length,
        succeeded: 0,
        failed: 0,
        running: 0
      }
      for (const run of props.runs) {
        if (run.status === RUN_STATUS.SUCCEEDED) result.succeeded += 1
        else if (run.status === RUN_STATUS.FAILED) result.failed += 1
        else if (run.status === RUN_STATUS.RUNNING) result.running += 1
      }
      return result
    },
    [props.runs]
  )

  const nameByID = useMemo(
    function () {
      const map: Record<string, string> = {}
      for (const task of props.tasks ?? []) map[task.id] = task.name
      return map
    },
    [props.tasks]
  )

  return (
    <div className="flex flex-col gap-2.5">
      {/* 分段筛选：浅底槽 + 选中块抬起成白底，与表单里的分段控件同一形态。
          窄栏（232px）下四格会挤，槽本身可横向滚动，标签不缩成「全…」。 */}
      <div className="bg-muted/50 flex items-center gap-0.5 overflow-x-auto rounded-lg p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map(function (item) {
          const count = counts[item.key]
          const active = filter === item.key
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              className={clsx(
                'flex h-6 min-w-fit flex-1 items-center justify-center gap-1 rounded-md px-2 text-xs whitespace-nowrap transition-colors',
                active
                  ? 'bg-background text-foreground shadow-xs font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={function () {
                updateFilter(item.key)
              }}>
              {item.label}
              <span
                className={clsx(
                  'text-[11px] tabular-nums',
                  active ? 'text-muted-foreground' : 'opacity-70'
                )}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <p className="text-muted-foreground px-0.5 text-xs leading-relaxed">
          {props.runs.length === 0 ? '还没有执行记录。' : '没有符合筛选条件的记录。'}
        </p>
      ) : null}

      {visible.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {visible.map(function (run) {
            const isOpen = Boolean(expanded[run.id])
            const duration = formatDuration(findRunDuration(run))
            const taskName = nameByID[run.automationId]
            const canRerun = Boolean(props.onRerun) && !props.running?.[run.automationId]
            const phase = findPhaseLabel(run.phase)
            return (
              <div
                key={run.id}
                className="border-border/60 bg-background/60 flex flex-col gap-1.5 rounded-lg border px-2.5 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-foreground shrink-0 text-xs tabular-nums">
                    {formatTime(run.startedAt ?? run.createdAt)}
                  </span>
                  <TaskStatusPill
                    tone={findStatusTone(run.status)}
                    label={
                      phase && run.status === RUN_STATUS.RUNNING
                        ? phase
                        : findLabel(DICT_TYPE.AUTOMATION_RUN_STATUS, run.status)
                    }
                  />
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                    {taskName ? `${taskName} · ` : ''}
                    {findLabel(DICT_TYPE.AUTOMATION_TRIGGER_KIND, run.triggerKind)} · 耗时{' '}
                    {duration}
                  </span>
                </div>

                {run.error ? (
                  <p className="text-destructive text-xs leading-relaxed break-words">
                    {run.error}
                  </p>
                ) : null}

                {run.output ? (
                  <p
                    className={clsx(
                      'text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap break-words',
                      !isOpen && 'line-clamp-3'
                    )}>
                    {run.output}
                  </p>
                ) : null}

                {run.output || props.onRerun || run.sessionId ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
                    {run.output ? (
                      <button
                        type="button"
                        className={LINK_BUTTON}
                        onClick={function () {
                          updateExpanded(function (prev) {
                            return { ...prev, [run.id]: !isOpen }
                          })
                        }}>
                        <Icon
                          icon={isOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'}
                          className="size-3"
                        />
                        {isOpen ? '收起输出' : '展开输出'}
                      </button>
                    ) : null}
                    {run.sessionId && props.onOpenSession ? (
                      <button
                        type="button"
                        className={LINK_BUTTON}
                        onClick={function () {
                          props.onOpenSession?.(run.sessionId!)
                        }}>
                        <Icon
                          icon="lucide:messages-square"
                          className="size-3"
                        />
                        打开会话
                      </button>
                    ) : null}
                    {props.onRerun ? (
                      <button
                        type="button"
                        className={LINK_BUTTON}
                        disabled={!canRerun}
                        title={canRerun ? '用这个任务的定义再跑一次' : '这个任务正在执行'}
                        onClick={function () {
                          props.onRerun?.(run.automationId)
                        }}>
                        <Icon
                          icon="lucide:rotate-cw"
                          className="size-3"
                        />
                        {canRerun ? '再跑一次' : '执行中'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export { TaskRuns }
export type { TaskRunsProps }
