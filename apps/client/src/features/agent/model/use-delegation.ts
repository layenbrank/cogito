/**
 * 委派长任务的副作用壳：提交、轮询进度、对审批做决定。
 *
 * 状态机（`derivePhase`）与「要不要弹审批卡」（`isApprovalPrompting`）在 `./delegate` 纯函数，
 * 这里只做三件事：发请求、按终态停轮询、把决定过的审批号记进本地集合避免重复弹窗。
 * 轮询由 `useEffect` 驱动：任务非终态时排一次延时快照，快照更新 `task` → effect 重跑再排
 * 下一次（不会积压并发请求）；终态（`SUCCEEDED` / `FAILED`）只看 `status`，进度有
 * 「落后一步」的特性，不拿它当停轮询的信号。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  GET_AGENT_TASK,
  POST_AGENT_TASKS,
  POST_AGENT_TASK_APPROVAL,
  type AgentTask,
  type ApprovalDecision,
  type SubmitAgentTaskParams
} from '@/apis/agent-task.ts'
import { derivePhase, isSettled, type DelegationPhase } from '@/features/agent/model/delegate.ts'

/** 轮询间隔：台账快照是「落后一步」的进度，1.5s 足够跟手，也不会把服务端打热。 */
const POLL_INTERVAL_MS = 1500

interface Delegation {
  task: AgentTask | null
  phase: DelegationPhase
  /** 已决定过的审批号（本地记忆，避免轮询再撞到同一条时重复弹窗） */
  decided: ReadonlySet<string>
  error: string | null
  submit: (params: SubmitAgentTaskParams) => Promise<void>
  decide: (approvalID: string, decision: ApprovalDecision) => Promise<void>
  reset: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败'
}

function useDelegation(): Delegation {
  const [task, updateTask] = useState<AgentTask | null>(null)
  const [submitting, updateSubmitting] = useState(false)
  const [decided, updateDecided] = useState<ReadonlySet<string>>(() => new Set())
  const [error, updateError] = useState<string | null>(null)
  const taskIDRef = useRef<string | null>(null)

  const phase = useMemo<DelegationPhase>(
    function () {
      if (submitting) return 'submitted'
      return derivePhase(task)
    },
    [submitting, task]
  )

  // 轮询：任务非终态时排一次延时快照；快照更新 task → 本 effect 重跑再排下一次。
  // 终态不排；卸载 / 换任务由 cleanup abort 在途 GET，避免过期快照盖住新状态。
  useEffect(
    function () {
      if (!task || isSettled(task)) return
      const id = task.id
      const controller = new AbortController()
      const timer = window.setTimeout(function () {
        GET_AGENT_TASK(id)
          .then(function (next) {
            if (!controller.signal.aborted) updateTask(next)
          })
          .catch(function (error: unknown) {
            if (controller.signal.aborted) return
            console.warn('[delegate] 轮询任务进度失败:', error)
          })
      }, POLL_INTERVAL_MS)
      return function () {
        window.clearTimeout(timer)
        controller.abort()
      }
    },
    [task]
  )

  const submit = useCallback(async function (params: SubmitAgentTaskParams) {
    updateError(null)
    updateSubmitting(true)
    updateDecided(new Set())
    try {
      const created = await POST_AGENT_TASKS(params)
      taskIDRef.current = created.id
      updateTask(created)
    } catch (error) {
      console.warn('[delegate] 提交任务失败:', error)
      taskIDRef.current = null
      updateTask(null)
      updateError(errorMessage(error))
    } finally {
      updateSubmitting(false)
    }
  }, [])

  const decide = useCallback(async function (approvalID: string, decision: ApprovalDecision) {
    const id = taskIDRef.current
    if (!id) return
    updateError(null)
    try {
      // applied=false 也是幂等成功；只有 POST 成功才本地记住，失败要保留审批卡让用户重试。
      await POST_AGENT_TASK_APPROVAL(id, approvalID, decision)
      updateDecided(function (prev) {
        const next = new Set(prev)
        next.add(approvalID)
        return next
      })
      try {
        const next = await GET_AGENT_TASK(id)
        updateTask(next)
      } catch (error) {
        console.warn('[delegate] 决定后刷新任务失败:', error)
      }
    } catch (error) {
      console.warn('[delegate] 提交审批决定失败:', error)
      updateError(errorMessage(error))
    }
  }, [])

  const reset = useCallback(function () {
    taskIDRef.current = null
    updateTask(null)
    updateSubmitting(false)
    updateDecided(new Set())
    updateError(null)
  }, [])

  return { task, phase, decided, error, submit, decide, reset }
}

export { useDelegation }
export type { Delegation }

