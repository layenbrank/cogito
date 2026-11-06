import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(function () {
  return { invokeMock: vi.fn() }
})

vi.mock('@tauri-apps/api/core', function () {
  return {
    invoke: function (...args: unknown[]): unknown {
      return invokeMock(...args) as unknown
    }
  }
})

import {
  bumpRevision,
  flush,
  hydrate,
  isPlanStale,
  readGoal,
  readPlan,
  resetPlanStore,
  saveGoal,
  savePlan,
  setPlanStatus
} from '@/features/agent/plan-store'
import { CHANNELS } from '@/shared/ipc/channels'

function planRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    sessionID: 't1',
    title: '计划',
    overview: '概述',
    steps: '["a","b"]',
    body: '# 计划\n\n1. a\n2. b',
    status: 'draft',
    source: 'thread',
    filePath: null,
    revision: 1,
    executedRevision: null,
    supersededBy: null,
    digest: 'd1',
    truncated: false,
    createdAt: 1,
    updatedAt: 1,
    executedAt: null,
    finishedAt: null,
    ...overrides
  }
}

describe('计划 / 目标档案仓储', function () {
  beforeEach(function () {
    resetPlanStore()
    invokeMock.mockReset()
    // 让 plan-store 认为自己在 Tauri 壳里，从而真的走 IPC
    ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    invokeMock.mockResolvedValue([])
  })

  it('hydrate 把库里的行灌进 cache，steps 从 JSON 还原', async function () {
    invokeMock.mockImplementation(function (channel: string) {
      if (channel === CHANNELS.AGENT_PLAN.TO_READ) return Promise.resolve([planRow()])
      return Promise.resolve([])
    })

    await hydrate(['t1'])

    const record = readPlan('t1')
    expect(record?.title).toBe('计划')
    expect(record?.steps).toEqual(['a', 'b'])
    expect(record?.body).toContain('1. a')
    expect(readPlan('t2')).toBeNull()
  })

  it('同一会话连续 save 只发一次 IPC（400ms 防抖）', async function () {
    vi.useFakeTimers()
    try {
      savePlan({ sessionID: 't1', body: '# 计划\n\n1. a\n2. b', steps: ['a', 'b'] })
      savePlan({ sessionID: 't1', title: '改个名', body: '# 计划\n\n1. a\n2. b', steps: ['a', 'b'] })
      savePlan({ sessionID: 't1', overview: '再改一下' })

      expect(invokeMock).not.toHaveBeenCalled()
      savePlan({ sessionID: 't1', overview: '最后一次' })
      await vi.runAllTimersAsync()

      const writes = invokeMock.mock.calls.filter(function (call) {
        return call[0] === CHANNELS.AGENT_PLAN.TO_WRITE
      })
      expect(writes).toHaveLength(1)
      const params = (writes[0][1] as { params: Record<string, unknown> }).params
      expect(params.sessionID).toBe('t1')
      // steps 在落库前要序列化成 JSON 字符串
      expect(params.steps).toBe(JSON.stringify(['a', 'b']))
      expect(params.overview).toBe('最后一次')
    } finally {
      vi.useRealTimers()
    }
  })

  it('状态机：running 记 executedAt，done 记 finishedAt', function () {
    savePlan({ sessionID: 't1' })
    const running = setPlanStatus('t1', 'running')
    expect(running?.status).toBe('running')
    expect(typeof running?.executedAt).toBe('number')

    const done = setPlanStatus('t1', 'done')
    expect(done?.status).toBe('done')
    expect(typeof done?.finishedAt).toBe('number')
    // executedAt 不被 done 覆盖掉
    expect(done?.executedAt).toBe(running?.executedAt)
  })

  it('digest 变化才自增 revision，且 running 回落 draft', function () {
    savePlan({ sessionID: 't1', body: 'v1', steps: ['a'] })
    setPlanStatus('t1', 'running')

    // 同样的 digest：什么都不改
    expect(bumpRevision('t1', readPlan('t1')!.digest)).toBe(false)
    expect(readPlan('t1')?.revision).toBe(1)

    expect(bumpRevision('t1', 'd2', { body: 'v2', steps: ['a', 'b'] })).toBe(true)
    const record = readPlan('t1')
    expect(record?.revision).toBe(2)
    expect(record?.status).toBe('draft')
    expect(record?.body).toBe('v2')
  })

  it('执行时锁住 executedRevision，改版后 stale 为真且旧值不清', function () {
    savePlan({ sessionID: 't1', body: 'v1', steps: ['a'] })
    expect(isPlanStale(readPlan('t1'))).toBe(false)

    setPlanStatus('t1', 'running')
    expect(readPlan('t1')?.executedRevision).toBe(1)
    expect(isPlanStale(readPlan('t1'))).toBe(false)

    expect(bumpRevision('t1', 'd2', { body: 'v2', steps: ['a', 'b'] })).toBe(true)
    expect(readPlan('t1')?.revision).toBe(2)
    expect(readPlan('t1')?.executedRevision).toBe(1)
    expect(isPlanStale(readPlan('t1'))).toBe(true)
  })

  it('done 的旧版在改版时归档成 superseded，并记 supersededBy', function () {
    savePlan({ sessionID: 't1', body: 'v1', steps: ['a'] })
    setPlanStatus('t1', 'running')
    setPlanStatus('t1', 'done')
    bumpRevision('t1', 'd2', { body: 'v2', steps: ['a', 'b'] })

    const record = readPlan('t1')
    expect(record?.status).toBe('superseded')
    expect(record?.supersededBy).toBe(2)
    expect(record?.executedRevision).toBe(1)
    // 重新按新版执行：归档态解除，executedRevision 跟到新版
    const running = setPlanStatus('t1', 'running')
    expect(running?.status).toBe('running')
    expect(running?.supersededBy).toBeNull()
    expect(running?.executedRevision).toBe(2)
    expect(isPlanStale(running)).toBe(false)
  })

  it('interrupted 的旧版同样归档，hydrate 带回两个新字段', async function () {
    savePlan({ sessionID: 't1', body: 'v1', steps: ['a'] })
    setPlanStatus('t1', 'running')
    setPlanStatus('t1', 'interrupted')
    bumpRevision('t1', 'd3', { body: 'v2' })
    expect(readPlan('t1')?.status).toBe('superseded')

    resetPlanStore()
    invokeMock.mockImplementation(function (channel: string) {
      if (channel === CHANNELS.AGENT_PLAN.TO_READ) {
        return Promise.resolve([planRow({ revision: 3, executedRevision: 2, supersededBy: 3 })])
      }
      return Promise.resolve([])
    })
    await hydrate(['t1'])
    expect(readPlan('t1')?.executedRevision).toBe(2)
    expect(readPlan('t1')?.supersededBy).toBe(3)
    expect(isPlanStale(readPlan('t1'))).toBe(true)
  })

  it('goal 档案按 sessionID upsert，二次保存不新增行', function () {
    saveGoal({ sessionID: 't1', summary: '目标', detail: '完整目标', budget: 6 })
    const updated = saveGoal({ sessionID: 't1', used: 2, status: 'exhausted' })

    expect(updated.id).toBe(readGoal('t1')?.id)
    expect(readGoal('t1')?.summary).toBe('目标')
    expect(readGoal('t1')?.used).toBe(2)
    expect(readGoal('t1')?.status).toBe('exhausted')
  })

  it('flush 把待写项排空（关闭前排空用）', async function () {
    savePlan({ sessionID: 't1', body: 'x' })
    await flush()
    expect(invokeMock).toHaveBeenCalled()
  })
})
