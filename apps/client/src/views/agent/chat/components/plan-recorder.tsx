/**
 * 计划录制器：把「最后一条 assistant 正文里的计划」落成**会话档案**。
 *
 * 为什么需要它：右栏计划原来由 `findPlanDraft()` 每次现算，用户下一轮问一句
 * 「这个函数在哪」，最后一条正文就变成问答，计划立刻消失。这里在每轮结束后
 * 把计划抽出来写进 `agent_plan`：
 *
 * - 还没有档案 + 本轮是计划文档 → 新建 `draft`；
 * - 已有档案 + digest 变了 → `revision + 1`（`running` 回落 `draft`）；
 * - 本轮不是计划文档 → **不动档案、绝不删行**（计划不会因为一次问答而消失）；
 * - 档案来自文件（`source = 'file'`）→ 以文件为准，对话里的回声不改它。
 *
 * 只在「不运行 + 正文变化」时比较 digest，所以不会每轮都写库（见 plan-store 的防抖）。
 */
import { useAuiState } from '@assistant-ui/react'
import { useEffect, useRef } from 'react'

import { findLastAssistantText, isPlanDocument, parsePlanText } from '@/features/agent/plan-draft'
import { bumpRevision, digestPlan, readPlan, savePlan } from '@/features/agent/plan-store'

function PlanRecorder() {
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const tail = useAuiState(function (state) {
    // 跑的时候正文还在长：等这一轮结束再判定，避免把半截计划录进去
    if (state.thread.isRunning) return ''
    return findLastAssistantText(state.thread.messages) ?? ''
  })
  /** 已处理过的「线程 + 正文」：同一段正文不重复写库 */
  const handled = useRef<string | null>(null)

  useEffect(
    function () {
      if (!threadID || !tail) return
      const draft = parsePlanText(tail)
      if (!draft || !isPlanDocument(tail)) return

      const digest = digestPlan(draft.body)
      const key = `${threadID}\0${digest}`
      if (handled.current === key) return

      const record = readPlan(threadID)
      // 从文件载入的计划以文件为准：模型在对话里的回声不能改掉它的正文与修订号
      if (record?.source === 'file') return

      handled.current = key
      if (!record) {
        savePlan({
          sessionID: threadID,
          title: draft.title,
          overview: draft.overview,
          steps: draft.steps,
          body: draft.body,
          digest,
          status: 'draft'
        })
        return
      }
      if (record.digest === digest) return
      bumpRevision(threadID, digest, {
        title: draft.title,
        overview: draft.overview,
        steps: draft.steps,
        body: draft.body
      })
    },
    [threadID, tail]
  )

  return null
}

export { PlanRecorder }
