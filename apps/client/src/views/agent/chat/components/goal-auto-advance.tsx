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

function GoalAutoAdvance() {
  const aui = useAui()
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const goal = useGoalRun(threadID)
  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  /** 已处理过的收尾文本：messages 每次变化都会让 effect 重跑，靠它去重 */
  const handled = useRef<string | null>(null)

  useEffect(
    function () {
      if (!goal || !threadID) return
      if (isRunning) return

      const last = findLastAssistant(messages)
      if (!last) return

      // 用户点了停止 / 出错：不是模型自己跑完的，交回手动控制
      if (isAbortedRun(last)) {
        stopGoalRun(threadID)
        return
      }

      const text = readAssistantText(last)
      if (!text || handled.current === text) return
      handled.current = text

      // 先把本轮自报的「达成 n/m」记下来，右栏进度条立刻跟上
      setGoalProgress(threadID, parseGoalProgress(text))

      const signal = findGoalSignal(text)
      if (signal === 'done') {
        toast.success('目标已完成')
        stopGoalRun(threadID)
        return
      }
      // 首轮宽松：模型常常先干一半再说，没打标记也继续推进；
      // 后续轮次没标记就视为已收敛，避免空转烧预算。
      if (!signal && goal.used > 0) {
        stopGoalRun(threadID)
        return
      }

      // 用户回到电脑前正在打字：不抢输入框，交回手动控制
      if (aui.composer.getState().text.trim()) {
        toast.info('检测到你在输入，已暂停目标自动推进')
        stopGoalRun(threadID)
        return
      }

      if (!advanceGoalRun(threadID)) {
        toast.warning(`已达目标推进上限（${goal.budget} 轮），请检查结果；需要继续可再次点「目标推进」`)
        stopGoalRun(threadID)
        return
      }
      const next = readGoalRun(threadID)
      if (!next) return
      aui.composer.setText(buildContinuePrompt(next))
      void aui.composer.send()
    },
    [aui, goal, threadID, isRunning, messages]
  )

  return null
}

export { GoalAutoAdvance }
