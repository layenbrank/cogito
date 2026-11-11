import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', function () {
  return { invoke: vi.fn() }
})

vi.mock('@tauri-apps/api/event', function () {
  // 真实 `listen` 返回 Promise：别的模块（如 browser/store）会直接 `.catch()`，
  // mock 返回 undefined 会让它们整片炸掉 —— 这里必须给一个 resolve 的 unlisten。
  return {
    listen: vi.fn(async function () {
      return function () {}
    })
  }
})

import {
  handleSpawn,
  MAX_DEPTH,
  SubagentSpawnSchema,
  type SubagentPorts
} from '@/features/agent/acp/subagent'

const job = {
  jobID: 'job-1',
  depth: 1,
  title: '整理日志',
  prompt: '把昨天的错误日志按模块归类',
  cwd: 'C:\\repo',
  parentSession: 's1'
}

function ports(overrides: Partial<SubagentPorts> = {}): SubagentPorts {
  return {
    createSession: vi.fn(async function () {
      return 'child-1'
    }),
    runTurn: vi.fn(async function () {
      return '归类完成：3 类，7 条'
    }),
    report: vi.fn(async function () {
      return undefined
    }),
    ...overrides
  }
}

describe('子 agent 派发（S10）', function () {
  it('成功：开子会话 → 跑一轮 → 回填摘要与 sessionID', async function () {
    const fake = ports()
    await expect(handleSpawn(job, fake)).resolves.toBe(true)
    expect(fake.createSession).toHaveBeenCalledWith(job)
    expect(fake.runTurn).toHaveBeenCalledWith({ threadID: 'child-1', job })
    expect(fake.report).toHaveBeenCalledWith({
      jobId: 'job-1',
      ok: true,
      summary: '归类完成：3 类，7 条',
      sessionId: 'child-1'
    })
  })

  it('失败：把原因回填，任务不许停在 queued', async function () {
    const fake = ports({
      runTurn: vi.fn(async function () {
        throw new Error('会话被中断')
      })
    })
    await expect(handleSpawn(job, fake)).resolves.toBe(true)
    expect(fake.report).toHaveBeenCalledWith({
      jobId: 'job-1',
      ok: false,
      error: '会话被中断',
      sessionId: 'child-1'
    })
  })

  it('开不出会话时也要回填（sessionId 缺省）', async function () {
    const fake = ports({
      createSession: vi.fn(async function () {
        throw new Error('数据库锁定')
      })
    })
    await handleSpawn(job, fake)
    expect(fake.runTurn).not.toHaveBeenCalled()
    expect(fake.report).toHaveBeenCalledWith({
      jobId: 'job-1',
      ok: false,
      error: '数据库锁定',
      sessionId: undefined
    })
  })

  it('越界（depth 超限）直接拒绝，不建会话', async function () {
    const fake = ports()
    await handleSpawn({ ...job, depth: MAX_DEPTH + 1 }, fake)
    expect(fake.createSession).not.toHaveBeenCalled()
    const report = vi.mocked(fake.report).mock.calls[0][0]
    expect(report.ok).toBe(false)
    expect(report.error).toContain(`最多 ${MAX_DEPTH} 层`)
  })

  it('非法事件（缺 prompt / 缺 jobID）不接活', async function () {
    const fake = ports()
    await expect(handleSpawn({ ...job, prompt: '' }, fake)).resolves.toBe(false)
    await expect(handleSpawn({ depth: 1 }, fake)).resolves.toBe(false)
    expect(fake.createSession).not.toHaveBeenCalled()
    expect(fake.report).not.toHaveBeenCalled()
  })

  it('schema 允许 cwd / parentSession 缺省（工具参数可以不给）', function () {
    const parsed = SubagentSpawnSchema.parse({
      jobID: 'j',
      depth: 1,
      title: '',
      prompt: '做事'
    })
    expect(parsed.cwd).toBeUndefined()
    expect(parsed.parentSession).toBeUndefined()
  })

  it('回填失败不把异常再抛出去（任务板超时兜底）', async function () {
    const fake = ports({
      report: vi.fn(async function () {
        throw new Error('命令不可用')
      })
    })
    await expect(handleSpawn(job, fake)).resolves.toBe(true)
  })
})
