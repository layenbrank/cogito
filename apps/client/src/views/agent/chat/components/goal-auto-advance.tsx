/**
 * 目标自动续跑：一轮结束且模型报告 `GOAL_CONTINUE` 时，自动发下一轮，
 * 直到 `GOAL_DONE`、预算用尽、用户中止，或用户正在输入。
 *
 * 挂载点放在聊天布局里（而不是右栏），切到别的页签也照常推进。
 */
import { useAui, useAuiState } from '@assistant-ui/react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import {
  advanceGoalRun,
  buildContinuePrompt,
  findGoalSignal,
  findLastAssistant,
  isAbortedRun,
  parseGoalProgress,
  readAssistantText,
  readGoalRun,
  setGoalProgress,
  stopGoalRun,
  useGoalRun
} from '@/features/agent/goal-run'

/**
 * 只订阅「最后一条助手消息」的收尾指纹，避免整份 messages 每 token 抬升本组件。
 * 指纹在 running 时为空（等回合结束再处理）。
 */
function findGoalTailDigest(messages: Parameters<typeof findLastAssistant>[0], isRunning: boolean) {
  if (isRunning) return ''
  const last = findLastAssistant(messages)
  if (!last) return ''
  const text = readAssistantText(last)
  const aborted = isAbortedRun(last) ? '1' : '0'
  return `${last.id}\0${aborted}\0${text}`
}

function GoalAutoAdvance() {
  const aui = useAui()
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const goal = useGoalRun(threadID)
  const tailDigest = useAuiState(function (state) {
    return findGoalTailDigest(state.thread.messages, state.thread.isRunning)
  })
  /** 已处理过的收尾指纹：digest 变化才推进 */
  const handled = useRef<string | null>(null)

  useEffect(
    function () {
      if (!goal || !threadID) return
      if (!tailDigest || handled.current === tailDigest) return
      handled.current = tailDigest

      const last = findLastAssistant(aui.thread.getState().messages)
      if (!last) return

      if (isAbortedRun(last)) {
        stopGoalRun(threadID)
        return
      }

      const text = readAssistantText(last)
      if (!text) return

      setGoalProgress(threadID, parseGoalProgress(text))

      const signal = findGoalSignal(text)
      if (signal === 'done') {
        toast.success('目标已完成')
        stopGoalRun(threadID)
        return
      }
      if (!signal && goal.used > 0) {
        stopGoalRun(threadID)
        return
      }

      if (aui.composer.getState().text.trim()) {
        toast.info('检测到你在输入，已暂停目标自动推进')
        stopGoalRun(threadID)
        return
      }

      if (!advanceGoalRun(threadID)) {
        toast.warning(
          `已达目标推进上限（${goal.budget} 轮），请检查结果；需要继续可再次点「目标推进」`
        )
        stopGoalRun(threadID)
        return
      }
      const next = readGoalRun(threadID)
      if (!next) return
      aui.composer.setText(buildContinuePrompt(next))
      void aui.composer.send()
    },
    [aui, goal, threadID, tailDigest]
  )

  return null
}

export { GoalAutoAdvance }
