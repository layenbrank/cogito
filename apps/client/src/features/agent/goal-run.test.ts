import { beforeEach, describe, expect, it } from 'vitest'

import { readApprovalModeFor, writeApprovalModeFor } from '@/features/agent/approval'
import {
  advanceGoalRun,
  buildContinuePrompt,
  findGoalSignal,
  finishGoalRun,
  parseGoalProgress,
  readGoalPrompt,
  readGoalRun,
  rememberGoalPrompt,
  resumeGoalRun,
  startGoalRun,
  stopGoalRun
} from '@/features/agent/goal-run'
import { readGoal, resetPlanStore } from '@/features/agent/plan-store'
describe('目标推进', function () {
  beforeEach(function () {
    resetPlanStore()
    stopGoalRun()
  })

  it('预算按「含首轮」计：轮数用完返回 false', function () {
    startGoalRun('t1', '覆盖率到 80%', 3)
    expect(advanceGoalRun('t1')).toBe(true) // 首轮做完，还剩 2 轮
    expect(advanceGoalRun('t1')).toBe(true) // 第 2 轮做完，还剩 1 轮
    expect(advanceGoalRun('t1')).toBe(false) // 第 3 轮做完，预算耗尽
    expect(readGoalRun('t1')?.used).toBe(3)
    // 预算用尽是一等状态：刷新后仍能显示「已用尽」
    expect(readGoalRun('t1')?.status).toBe('exhausted')
    expect(readGoal('t1')?.status).toBe('exhausted')
  })

  /**
   * 回归：`useGoalRun` 把 `readGoalRun` 当 `useSyncExternalStore` 的 getSnapshot。
   * 每次现造对象 = 快照永远「变了」→ 无限重渲染 → React #185（整页进 ErrorBoundary）。
   */
  it('快照引用稳定：同一份档案两次读取返回同一个对象', function () {
    startGoalRun('t1', 'x', 4)
    const first = readGoalRun('t1')
    expect(first).not.toBeNull()
    expect(readGoalRun('t1')).toBe(first)

    // 档案被替换（推进一步）后才允许换新快照
    advanceGoalRun('t1')
    const next = readGoalRun('t1')
    expect(next).not.toBe(first)
    expect(next?.used).toBe(1)
    expect(readGoalRun('t1')).toBe(next)
  })

  it('多会话并发：各自的预算与进度互不影响', function () {
    startGoalRun('t1', '目标 A', 2)
    startGoalRun('t2', '目标 B', 4)

    advanceGoalRun('t1')
    advanceGoalRun('t2')
    advanceGoalRun('t2')

    expect(readGoalRun('t1')?.used).toBe(1)
    expect(readGoalRun('t2')?.used).toBe(2)
    expect(readGoalRun('t1')?.objective).toBe('目标 A')
    expect(readGoalRun('t2')?.budget).toBe(4)

    // 停 t1 不影响 t2
    stopGoalRun('t1')
    expect(readGoalRun('t1')).toBeNull()
    expect(readGoalRun('t2')?.used).toBe(2)
  })

  it('只认本线程的推进；没登记的线程不会误用预算', function () {
    startGoalRun('t1', 'x', 6)
    expect(advanceGoalRun('t2')).toBe(false)
    expect(readGoalRun('t1')?.used).toBe(0)
    expect(readGoalRun('t2')).toBeNull()
  })

  it('收尾标记：done / continue / 无，且容忍 markdown 装饰', function () {
    expect(findGoalSignal('总结…\nGOAL_DONE')).toBe('done')
    expect(findGoalSignal('GOAL_CONTINUE\n还有 2 项')).toBe('continue')
    expect(findGoalSignal('随便一段话')).toBeNull()
    // 不能被子串误判
    expect(findGoalSignal('GOAL_DONEx')).toBeNull()
    // 模型常把标记加粗 / 加代码块 / 加句号 / 写成小写标题
    expect(findGoalSignal('总结…\n**GOAL_DONE**')).toBe('done')
    expect(findGoalSignal('`GOAL_DONE`')).toBe('done')
    expect(findGoalSignal('GOAL_DONE。')).toBe('done')
    expect(findGoalSignal('## GOAL_DONE')).toBe('done')
    expect(findGoalSignal('goal_done')).toBe('done')
    // done 优先于 continue（两者都出现在行首时）
    expect(findGoalSignal('GOAL_CONTINUE\nGOAL_DONE')).toBe('done')
  })

  it('续跑指令带轮次与目标，避免长上下文里漂移', function () {
    startGoalRun('t1', '把 pnpm unit 跑绿', 4)
    advanceGoalRun('t1')
    const prompt = buildContinuePrompt(readGoalRun('t1')!)
    expect(prompt).toContain('第 2/4 轮')
    expect(prompt).toContain('把 pnpm unit 跑绿')
    expect(prompt).toContain('GOAL_CONTINUE')
  })

  it('停止后不再返回进行中的目标，但档案留成 paused', function () {
    startGoalRun('t1', 'x', 2)
    stopGoalRun('t1')
    expect(readGoalRun('t1')).toBeNull()
    expect(advanceGoalRun('t1')).toBe(false)
    expect(readGoal('t1')?.status).toBe('paused')
  })

  it('GOAL_DONE 写成 done，不会被 stopGoalRun 抹成 paused', function () {
    startGoalRun('t1', 'x', 4)
    finishGoalRun('t1', 'done')
    expect(readGoal('t1')?.status).toBe('done')
    stopGoalRun('t1')
    expect(readGoal('t1')?.status).toBe('done')
  })

  it('预算用尽后 stopGoalRun 不能覆盖 exhausted', function () {
    startGoalRun('t1', 'x', 1)
    expect(advanceGoalRun('t1')).toBe(false)
    expect(readGoal('t1')?.status).toBe('exhausted')
    stopGoalRun('t1')
    expect(readGoal('t1')?.status).toBe('exhausted')
    finishGoalRun('t1', 'exhausted')
    expect(readGoal('t1')?.status).toBe('exhausted')
  })

  it('expectedPrompt 落进档案；resume 重置 used 并回到 running', function () {
    startGoalRun('t1', '覆盖率到 80%', 3, '首轮原文')
    expect(readGoalPrompt('t1')).toBe('首轮原文')
    expect(readGoal('t1')?.expectedPrompt).toBe('首轮原文')
    rememberGoalPrompt('t1', '续跑指令')
    expect(readGoal('t1')?.expectedPrompt).toBe('续跑指令')
    stopGoalRun('t1')
    expect(readGoal('t1')?.status).toBe('paused')
    const resumed = resumeGoalRun('t1')
    expect(resumed?.status).toBe('running')
    expect(resumed?.used).toBe(0)
    expect(resumed?.budget).toBe(3)
    expect(resumed?.objective).toBe('覆盖率到 80%')
  })

  it('空串 / null 是 no-op，不会崩也不会误停其它线程的目标', function () {
    startGoalRun('t1', 'x', 2)
    expect(function () {
      stopGoalRun('')
    }).not.toThrow()
    expect(function () {
      stopGoalRun(null)
    }).not.toThrow()
    expect(readGoalRun('t1')?.used).toBe(0)
  })

  it('启动时记下启动前的审批档，结束后据此还原', function () {
    // 前面用例可能已经把这个会话的审批档改成 auto（目标推进期间），先复位
    writeApprovalModeFor('t9', 'ask')
    startGoalRun('t9', 'x', 2)
    // 启动时的档位被记进档案：结束后据此还原
    expect(readGoal('t9')?.approvalBefore).toBe('ask')
    stopGoalRun('t9')
    expect(readApprovalModeFor('t9')).toBe('ask')
  })

  it('达成 n/m：认「达成」前缀与「m 项」后缀，不误吃轮次数字', function () {
    expect(parseGoalProgress('验收标准达成 3/5')).toEqual({ done: 3, total: 5 })
    expect(parseGoalProgress('共完成 4/4 条')).toEqual({ done: 4, total: 4 })
    expect(parseGoalProgress('4/6 项已达成')).toEqual({ done: 4, total: 6 })
    // 「第 2/4 轮」里的分数不能当成进度
    expect(parseGoalProgress('继续推进目标（第 2/4 轮）')).toBeNull()
    expect(parseGoalProgress('达成 6/5')).toBeNull()
  })
})
