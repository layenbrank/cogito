import { beforeEach, describe, expect, it } from 'vitest'

import {
  advanceGoalRun,
  buildContinuePrompt,
  findGoalSignal,
  parseGoalProgress,
  readGoalRun,
  startGoalRun,
  stopGoalRun
} from '@/features/agent/goal-run'

describe('目标推进', function () {
  beforeEach(function () {
    stopGoalRun()
  })

  it('预算按「含首轮」计：轮数用完返回 false', function () {
    startGoalRun('t1', '覆盖率到 80%', 3)
    expect(advanceGoalRun('t1')).toBe(true) // 首轮做完，还剩 2 轮
    expect(advanceGoalRun('t1')).toBe(true) // 第 2 轮做完，还剩 1 轮
    expect(advanceGoalRun('t1')).toBe(false) // 第 3 轮做完，预算耗尽
    expect(readGoalRun('t1')?.used).toBe(3)
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

  it('收尾标记：done / continue / 无', function () {
    expect(findGoalSignal('总结…\nGOAL_DONE')).toBe('done')
    expect(findGoalSignal('GOAL_CONTINUE\n还有 2 项')).toBe('continue')
    expect(findGoalSignal('随便一段话')).toBeNull()
    // 不能被子串误判
    expect(findGoalSignal('GOAL_DONEx')).toBeNull()
  })

  it('续跑指令带轮次与目标，避免长上下文里漂移', function () {
    startGoalRun('t1', '把 pnpm unit 跑绿', 4)
    advanceGoalRun('t1')
    const prompt = buildContinuePrompt(readGoalRun('t1')!)
    expect(prompt).toContain('第 2/4 轮')
    expect(prompt).toContain('把 pnpm unit 跑绿')
    expect(prompt).toContain('GOAL_CONTINUE')
  })

  it('停止后状态清空', function () {
    startGoalRun('t1', 'x', 2)
    stopGoalRun('t1')
    expect(readGoalRun('t1')).toBeNull()
    expect(advanceGoalRun('t1')).toBe(false)
  })

  it('空串是 no-op，不会误停其它线程的目标', function () {
    startGoalRun('t1', 'x', 2)
    stopGoalRun('')
    expect(readGoalRun('t1')?.used).toBe(0)
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
