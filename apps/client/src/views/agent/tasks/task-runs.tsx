/**
 * 执行记录：任务详情里的「这一条任务的记录」与页面级「全部记录」共用。
 *
 * 记录来自 `automation_run`（本机 / goose 手动触发没有本地记录时会直接提示）。
 * 状态筛选在纯函数里做（`model.filterRuns`），这里只管展开与「再跑一次」。
 *
 * 布局：292px 宽下，行内按钮和元信息抢同一行会把「耗时」挤成省略号，
 * 所以动作统一收进底部一行（展开输出 / 再跑一次），元信息独占一行。
 */
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import { useMemo, useState } from 'react'

import type { Automation, AutomationRun } from '@/shared/ipc/specs/automation'
import { DICT_TYPE } from '@/shared/ipc/specs/dict'
import { useDictStore } from '@/stores/dict'
import { formatTime } from '@/views/knowledge/lib/format.ts'
import { RUN_STATUS, filterRuns, findRunDuration, formatDuration, type RunFilter } from './model'
import styles from './tasks.module.scss'

interface TaskRunsProps {
  runs: AutomationRun[]
  /** 全部记录视图：每条要标出是哪个任务 */
  tasks?: Automation[]
  /** 不传 = 不能重跑（例如 goose 任务在本地没有执行入口） */
  onRerun?: (automationId: string) => void
  /** 正在跑的任务 id 集合：按钮显示「执行中」 */
  running?: Record<string, boolean>
}

const FILTERS: readonly { key: RunFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'succeeded', label: '成功' },
  { key: 'failed', label: '失败' },
  { key: 'running', label: '执行中' }
]

function statusTone(status: string): string {
  if (status === RUN_STATUS.SUCCEEDED) return styles.badgeOk
  if (status === RUN_STATUS.FAILED) return styles.badgeFail
  if (status === RUN_STATUS.RUNNING) return styles.badgeRunning
  return styles.badgeIdle
}

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
    <div className={styles.runs}>
      <div className={styles.runFilters}>
        {FILTERS.map(function (item) {
          const count = counts[item.key]
          return (
            <button
              key={item.key}
              type="button"
              className={clsx(styles.filterBtn, filter === item.key && styles.filterActive)}
              onClick={function () {
                updateFilter(item.key)
              }}>
              {item.label}
              <span className={styles.filterCount}>{count}</span>
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <p className={styles.runsEmpty}>
          {props.runs.length === 0 ? '还没有执行记录。' : '没有符合筛选条件的记录。'}
        </p>
      ) : null}

      {visible.map(function (run) {
        const isOpen = Boolean(expanded[run.id])
        const duration = formatDuration(findRunDuration(run))
        const taskName = nameByID[run.automationId]
        const canRerun = Boolean(props.onRerun) && !props.running?.[run.automationId]
        return (
          <div
            key={run.id}
            className={styles.runRow}>
            <div className={styles.runHead}>
              <span className={styles.runTime}>{formatTime(run.startedAt ?? run.createdAt)}</span>
              <span className={clsx(styles.badge, statusTone(run.status))}>
                {findLabel(DICT_TYPE.AUTOMATION_RUN_STATUS, run.status)}
              </span>
              <span className={styles.runMeta}>
                {taskName ? `${taskName} · ` : ''}
                {findLabel(DICT_TYPE.AUTOMATION_TRIGGER_KIND, run.triggerKind)} · 耗时 {duration}
              </span>
            </div>

            {run.error ? <p className={styles.runError}>{run.error}</p> : null}

            {run.output ? (
              <p className={clsx(styles.runOutput, !isOpen && 'line-clamp-3')}>{run.output}</p>
            ) : null}

            {run.output || props.onRerun ? (
              <div className={styles.runActions}>
                {run.output ? (
                  <button
                    type="button"
                    className={styles.runAction}
                    onClick={function () {
                      updateExpanded(function (prev) {
                        return { ...prev, [run.id]: !isOpen }
                      })
                    }}>
                    {isOpen ? '收起输出' : '展开输出'}
                  </button>
                ) : null}
                {props.onRerun ? (
                  <button
                    type="button"
                    className={styles.runAction}
                    disabled={!canRerun}
                    title={canRerun ? '用这个任务的定义再跑一次' : '这个任务正在执行'}
                    onClick={function () {
                      props.onRerun?.(run.automationId)
                    }}>
                    <Icon
                      icon="lucide:rotate-cw"
                      className="me-0.5 inline size-3 align-[-2px]"
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
  )
}

export { TaskRuns }
export type { TaskRunsProps }
