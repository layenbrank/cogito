/**
 * 输出页的运行选择：并发运行时每个运行实例占一个标签，
 * 标签条与输出区共用这一份视图，保证「看到的就是选中的那个运行」。
 */
import { useMemo } from 'react'

import { useCorexStore, type CorexRun } from '@/stores/corex.ts'

/** 已结束的运行只保留最近几页标签，避免标签条无限膨胀 */
const MAX_FINISHED_TABS = 6

interface RunSelection {
  tabs: CorexRun[]
  selected: CorexRun | null
  /** 选中运行所属指令的总步数；取不到时按 0 处理（进度不定长） */
  stepCount: number
}

function byStartedAsc(left: CorexRun, right: CorexRun): number {
  return left.startedAt.getTime() - right.startedAt.getTime()
}

function byStartedDesc(left: CorexRun, right: CorexRun): number {
  return right.startedAt.getTime() - left.startedAt.getTime()
}

function useRunSelection(): RunSelection {
  const runs = useCorexStore(function (state) {
    return state.runs
  })
  const focusRunId = useCorexStore(function (state) {
    return state.focusRunId
  })
  const directives = useCorexStore(function (state) {
    return state.directives
  })
  const draft = useCorexStore(function (state) {
    return state.draft
  })
  const editorName = useCorexStore(function (state) {
    return state.editorName
  })

  return useMemo(
    function () {
      const focus = focusRunId
        ? (runs.find(function (run) {
            return run.id === focusRunId
          }) ?? null)
        : null
      const active = runs
        .filter(function (run) {
          return run.status === 'running'
        })
        .sort(byStartedAsc)
      const finished = runs
        .filter(function (run) {
          return run.status !== 'running'
        })
        .sort(byStartedDesc)
        .slice(0, MAX_FINISHED_TABS)
      // 焦点运行可能已被上面截断，补一张标签，否则选中的页签找不到
      if (focus && focus.status !== 'running' && !finished.includes(focus)) finished.unshift(focus)

      const tabs = [...active, ...finished]
      const selected = focus ?? active[active.length - 1] ?? tabs[0] ?? null
      const edited = selected && draft && editorName === selected.name ? draft : null
      const stepCount = !selected
        ? 0
        : edited && Array.isArray(edited.steps)
          ? edited.steps.length
          : (directives.find(function (entry) {
              return entry.name === selected.name
            })?.summary?.step_count ?? 0)

      return { tabs, selected, stepCount }
    },
    [runs, focusRunId, directives, draft, editorName]
  )
}

export { useRunSelection }
export type { RunSelection }
