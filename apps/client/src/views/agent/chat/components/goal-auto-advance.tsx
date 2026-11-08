/**
 * 目标自动续跑：一轮结束且模型报告 `GOAL_CONTINUE` 时，自动发下一轮，
 * 直到 `GOAL_DONE`、预算用尽、用户中止，或用户插话 / 正在输入。
 *
 * 挂载点放在聊天布局里（而不是右栏），切到别的页签也照常推进。
 *
 * 「本轮归属」是这里最容易出错的地方：以前只要 `goal` 存在就当成目标轮，
 * 用户中途问一句话也会被当成「本轮未达成」直接把目标停掉。现在必须满足
 * ①这一轮的 user 消息就是我们发的那条续跑指令（或首轮）；②最后一条不是用户插话；
 * ③composer 为空（用户没正在打字）。任一不满足就 `paused`，不自动续跑。
 */
import { useAui, useAuiState } from '@assistant-ui/react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import {
  advanceGoal,
  findGoalSignal,
  findLastAssistant,
  findLastUserText,
  isAbortedRun,
  isUserInterjection,
  parseGoalProgress,
  readAssistantText,
  readGoalPrompt,
  setGoalProgress,
  useGoalRun
} from '@/features/agent/goal-run'
import { isPlanStale, readPlan } from '@/features/agent/plan-store'

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

function normalizePrompt(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
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

      const messages = aui.thread.getState().messages
      const last = findLastAssistant(messages)
      if (!last) return

      if (isAbortedRun(last)) {
        // 用户「停止」/ 出错：这一轮不是模型自己跑完的，不能当成「未达成」继续
        advanceGoal(threadID, 'aborted')
        return
      }

      const text = readAssistantText(last)
      if (!text) return

      setGoalProgress(threadID, parseGoalProgress(text))

      const signal = findGoalSignal(text)
      if (signal === 'done') {
        if (advanceGoal(threadID, 'done').kind === 'done') toast.success('目标已完成')
        return
      }
      if (!signal && goal.used > 0) {
        toast.info('目标推进已停：本轮未输出 GOAL_CONTINUE / GOAL_DONE')
        advanceGoal(threadID, 'no-signal')
        return
      }

      /**
       * 本轮归属：首轮由用户发出（不做归属校验），后续轮必须是自动续跑那一条。
       * 用户插话后 user 消息就不再是我们发的 prompt —— 命中即停，而不是当成「未达成」。
       */
      const expected = normalizePrompt(readGoalPrompt(threadID))
      const lastUser = normalizePrompt(findLastUserText(messages))
      if (goal.used > 0 && expected && lastUser !== expected) {
        toast.info('检测到你插话了，目标推进已暂停')
        advanceGoal(threadID, 'interjection')
        return
      }
      if (isUserInterjection(messages)) {
        toast.info('检测到你发了新消息，目标推进已暂停')
        advanceGoal(threadID, 'interjection')
        return
      }

      if (aui.composer.getState().text.trim()) {
        toast.info('检测到你在输入，已暂停目标自动推进')
        advanceGoal(threadID, 'typing')
        return
      }

      /**
       * 计划改过就先停车：`revision > executedRevision` 说明这一轮跑的是旧版，
       * 继续自动续跑只会拿旧计划反复烧 token（用户看到的「计划重复执行」）。
       */
      if (isPlanStale(readPlan(threadID))) {
        toast.info(
          '计划已更新，目标推进已暂停：确认后请按新计划重新开始（不会拿旧版继续跑）'
        )
        advanceGoal(threadID, 'plan-stale')
        return
      }

      // 唯一入口：拿到活租约才真的推进；重复 / 迟到的结束回调一律 ignored（单飞）
      const outcome = advanceGoal(threadID, 'continue')
      if (outcome.kind === 'exhausted') {
        toast.warning(
          `已达目标推进上限（${goal.budget} 轮），请检查结果；需要继续可再次点「继续推进」`
        )
        return
      }
      if (outcome.kind !== 'dispatch') return
      // 续跑 prompt 已由 advanceGoal 记进档案（下一轮据此判断「还是不是目标轮」）
      aui.composer.setText(outcome.prompt)
      void aui.composer.send()
    },
    [aui, goal, threadID, tailDigest]
  )

  return null
}

export { GoalAutoAdvance }
