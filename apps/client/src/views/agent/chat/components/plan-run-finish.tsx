/**
 * 计划执行收尾：`status === running` 时监听本轮助手结束，写入 done / interrupted。
 *
 * - 普通「开始执行」：一轮正常结束 → done；中止 → interrupted
 * - 「目标推进」：Goal 终态驱动计划（done/exhausted → done；paused → interrupted）
 */
import { useAui, useAuiState } from '@assistant-ui/react'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import {
  findLastAssistant,
  isAbortedRun,
  readGoalRun,
  useGoalRun
} from '@/features/agent/goal-run'
import {
  readGoal,
  readPlan,
  setPlanStatus,
  subscribePlanStore
} from '@/features/agent/plan-store'

function findPlanTailDigest(
  messages: Parameters<typeof findLastAssistant>[0],
  isRunning: boolean
) {
  if (isRunning) return ''
  const last = findLastAssistant(messages)
  if (!last) return ''
  const aborted = isAbortedRun(last) ? '1' : '0'
  return `${last.id}\0${aborted}`
}

function PlanRunFinish() {
  const aui = useAui()
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const plan = useSyncExternalStore(
    subscribePlanStore,
    function () {
      return threadID ? readPlan(threadID) : null
    },
    function () {
      return threadID ? readPlan(threadID) : null
    }
  )
  const goal = useGoalRun(threadID)
  const goalRecord = useSyncExternalStore(
    subscribePlanStore,
    function () {
      return threadID ? readGoal(threadID) : null
    },
    function () {
      return threadID ? readGoal(threadID) : null
    }
  )
  const tailDigest = useAuiState(function (state) {
    return findPlanTailDigest(state.thread.messages, state.thread.isRunning)
  })
  const handled = useRef<string | null>(null)

  // Goal 驱动的计划执行：跟 Goal 终态走
  useEffect(
    function () {
      if (!threadID || !plan || plan.status !== 'running') return
      if (!goalRecord) return
      if (goalRecord.status === 'running') return
      if (goalRecord.status === 'done' || goalRecord.status === 'exhausted') {
        setPlanStatus(threadID, 'done')
        return
      }
      if (goalRecord.status === 'paused') {
        setPlanStatus(threadID, 'interrupted')
      }
    },
    [threadID, plan, goalRecord]
  )

  // 普通执行：单轮助手收尾即结案（进行中的 Goal 不在此收）
  useEffect(
    function () {
      if (!threadID || !plan || plan.status !== 'running') return
      if (goal || readGoalRun(threadID)) return
      if (!tailDigest || handled.current === tailDigest) return
      handled.current = tailDigest

      const messages = aui.thread.getState().messages
      const last = findLastAssistant(messages)
      if (!last) return
      setPlanStatus(threadID, isAbortedRun(last) ? 'interrupted' : 'done')
    },
    [aui, threadID, plan, goal, tailDigest]
  )

  return null
}

export { PlanRunFinish }
