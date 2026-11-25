/**
 * 计划执行收尾：`status === 'running'` 时监听本轮助手结束，交给 `plan-execute-session` 结案。
 *
 * - 普通「开始执行」：一轮正常结束 → done；中止 → interrupted
 * - 「目标推进」：Goal 终态驱动计划（done/exhausted → done；paused → interrupted）
 *
 * 这里只做**观察**，不自己写档位：基线尾部与幂等都在状态机里（F-017）。组件卸载 / 重挂
 * 不会让「这条尾巴已经结过案」的记忆丢失，订阅重放也不会重复写。
 */
import { useAui, useAuiState } from '@assistant-ui/react'
import { useEffect, useSyncExternalStore } from 'react'

import {
  findLastAssistant,
  isAbortedRun,
  readGoalRun,
  useGoalRun
} from '@/features/agent/goal-run'
import { readGoal, readPlan, subscribePlanStore } from '@/features/agent/plan-store'
import { finishPlanExecution } from '@/features/agent/plan-execute-session'
import { useSessionThreadID } from './use-session-thread-id'

/**
 * 只订阅「最后一条助手消息」的收尾指纹。
 * running 时为空（这一轮还没结束）；正文不进指纹（每 token 都变会让选择器重算）。
 */
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
  // 档案按**库内** id 存，与 `plan-recorder` / `goal-auto-advance` 同一把键
  const threadID = useSessionThreadID()
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

  // Goal 驱动的计划执行：跟 Goal 终态走（不看消息尾部，故 `force`）
  useEffect(
    function () {
      if (!threadID || !plan || plan.status !== 'running') return
      if (!goalRecord) return
      if (goalRecord.status === 'running') return
      if (goalRecord.status === 'done' || goalRecord.status === 'exhausted') {
        finishPlanExecution(threadID, null, 'done', { force: true })
        return
      }
      if (goalRecord.status === 'paused') {
        finishPlanExecution(threadID, null, 'interrupted', { force: true })
      }
    },
    [threadID, plan, goalRecord]
  )

  // 普通执行：单轮助手收尾即结案（进行中的 Goal 不在此收）
  useEffect(
    function () {
      if (!threadID || !plan || plan.status !== 'running') return
      if (goal || readGoalRun(threadID)) return
      if (!tailDigest) return

      const last = findLastAssistant(aui.thread.getState().messages)
      if (!last) return
      // 状态机自己判「这条尾部是不是开始之后出现的」「是不是已经结过案」
      finishPlanExecution(threadID, last.id, isAbortedRun(last) ? 'interrupted' : 'done')
    },
    [aui, threadID, plan, goal, tailDigest]
  )

  return null
}

export { PlanRunFinish }
