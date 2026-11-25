/**
 * 计划执行状态机的单测。
 *
 * 每条用例对应一个真实症状：
 * - 一点执行就 done（观察器看到的是开始之前那条消息）；
 * - 发送被闸门拦下、计划却永远「执行中」；
 * - 连点两次发出两份计划正文（第二份还白吃一轮预算）；
 * - 订阅重放导致终态被写两次。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  beginPlanExecution,
  clearPlanExecutions,
  finishPlanExecution,
  isPlanExecutionActive,
  setPlanStatusWriter
} from '@/features/agent/plan-execute-session'
import type { PlanStatus } from '@/features/agent/plan-store'

const THREAD = 'thread-plan-1'

let writes: Array<{ threadID: string; status: PlanStatus }> = []

beforeEach(function () {
  writes = []
  setPlanStatusWriter(function (threadID: string, status: PlanStatus) {
    writes.push({ threadID, status })
  })
})

afterEach(function () {
  clearPlanExecutions()
})

function baseInput(overrides: Partial<Parameters<typeof beginPlanExecution>[0]> = {}) {
  return {
    threadID: THREAD,
    target: 'agent' as const,
    baselineTailID: 'assistant-plan',
    prepare: function () {
      return Promise.resolve()
    },
    send: function () {
      return true
    },
    ...overrides
  }
}

describe('beginPlanExecution', function () {
  it('准备 + 发送都成功才置 running', async function () {
    const prepare = vi.fn(function () {
      return Promise.resolve()
    })
    const send = vi.fn(function () {
      return true
    })
    const outcome = await beginPlanExecution(baseInput({ prepare, send }))

    expect(outcome).toEqual({ ok: true })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([{ threadID: THREAD, status: 'running' }])
    expect(isPlanExecutionActive(THREAD)).toBe(true)
  })

  it('发送没真发出去：不置 running，并回滚（目标记录收掉）', async function () {
    const rollback = vi.fn()
    const outcome = await beginPlanExecution(
      baseInput({
        target: 'goal',
        send: function () {
          return false
        },
        rollback
      })
    )

    expect(outcome).toEqual({ ok: false, reason: 'not-sent' })
    expect(writes).toEqual([])
    expect(isPlanExecutionActive(THREAD)).toBe(false)
    expect(rollback).toHaveBeenCalledTimes(1)
  })

  it('prepare 抛错：不发送、回滚、错误往上抛', async function () {
    const send = vi.fn(function () {
      return true
    })
    const rollback = vi.fn()
    await expect(
      beginPlanExecution(
        baseInput({
          prepare: function () {
            return Promise.reject(new Error('mode 同步失败'))
          },
          send,
          rollback
        })
      )
    ).rejects.toThrow('mode 同步失败')

    expect(send).not.toHaveBeenCalled()
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(isPlanExecutionActive(THREAD)).toBe(false)
  })

  it('单飞：准备还没完成时第二次点击直接被拒（不会发两份计划正文）', async function () {
    let release: () => void = function () {}
    const gate = new Promise<void>(function (resolve) {
      release = resolve
    })
    const first = beginPlanExecution(
      baseInput({
        prepare: function () {
          return gate
        }
      })
    )
    // 同 tick 的第二次点击
    const second = await beginPlanExecution(baseInput())
    expect(second).toEqual({ ok: false, reason: 'busy' })

    release()
    await expect(first).resolves.toEqual({ ok: true })
    expect(writes).toEqual([{ threadID: THREAD, status: 'running' }])
  })
})

describe('finishPlanExecution', function () {
  it('开始之前那条助手消息不能用来结案（「一点执行就 done」）', async function () {
    await beginPlanExecution(baseInput())
    // 观察器看到的还是计划正文那条
    expect(finishPlanExecution(THREAD, 'assistant-plan', 'done')).toBe(false)
    expect(writes).toEqual([{ threadID: THREAD, status: 'running' }])
    expect(isPlanExecutionActive(THREAD)).toBe(true)
  })

  it('出现新的助手消息才算这一轮结束', async function () {
    await beginPlanExecution(baseInput())
    expect(finishPlanExecution(THREAD, 'assistant-run', 'done')).toBe(true)
    expect(writes).toEqual([
      { threadID: THREAD, status: 'running' },
      { threadID: THREAD, status: 'done' }
    ])
    expect(isPlanExecutionActive(THREAD)).toBe(false)
  })

  it('幂等：同一条尾巴重放只结一次案', async function () {
    await beginPlanExecution(baseInput())
    expect(finishPlanExecution(THREAD, 'assistant-run', 'done')).toBe(true)
    // 订阅重放 / 重挂后再报一次同一条
    expect(finishPlanExecution(THREAD, 'assistant-run', 'done')).toBe(false)
    expect(writes).toHaveLength(2)
  })

  it('没有执行中的计划时一律忽略（历史里的旧消息不会乱改档位）', function () {
    expect(finishPlanExecution(THREAD, 'assistant-old', 'done')).toBe(false)
    expect(writes).toEqual([])
  })

  it('目标推进用 force：不看尾巴，按 Goal 终态直接结案', async function () {
    await beginPlanExecution(baseInput({ target: 'goal' }))
    expect(finishPlanExecution(THREAD, null, 'interrupted', { force: true })).toBe(true)
    expect(writes).toEqual([
      { threadID: THREAD, status: 'running' },
      { threadID: THREAD, status: 'interrupted' }
    ])
  })
})
