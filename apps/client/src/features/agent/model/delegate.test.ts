import { describe, expect, it } from 'vitest'

import type { AgentTask } from '@/apis/agent-task.ts'
import {
  derivePhase,
  isApprovalPrompting,
  isSettled,
  parseToolArguments
} from '@/features/agent/model/delegate.ts'

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'task-1',
    tenantID: 'tenant-1',
    userID: null,
    status: 'RUNNING',
    objective: '把产品手册总结成一段话',
    model: 'model-1',
    maxSteps: 3,
    allowedTools: [],
    steps: 1,
    progress: 'step:1/3',
    pendingApproval: null,
    finished: null,
    result: null,
    error: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

describe('derivePhase', function () {
  it('没有任务是 idle', function () {
    expect(derivePhase(null)).toBe('idle')
  })

  it('RUNNING 且无待审批是 running', function () {
    expect(derivePhase(task())).toBe('running')
  })

  it('有待审批是 awaiting_approval（即使 status 仍是 RUNNING）', function () {
    expect(
      derivePhase(
        task({
          pendingApproval: {
            approvalID: 'a',
            step: 2,
            tool: 'memory_write',
            arguments: '{}',
            expiresAt: Number.MAX_SAFE_INTEGER
          }
        })
      )
    ).toBe('awaiting_approval')
  })

  it('SUCCEEDED 与 FAILED 都是 settled', function () {
    expect(derivePhase(task({ status: 'SUCCEEDED' }))).toBe('settled')
    expect(derivePhase(task({ status: 'FAILED' }))).toBe('settled')
  })
})

describe('isSettled', function () {
  it('只看 status', function () {
    expect(isSettled(task({ status: 'SUCCEEDED' }))).toBe(true)
    expect(isSettled(task({ status: 'FAILED' }))).toBe(true)
    expect(isSettled(task({ status: 'RUNNING' }))).toBe(false)
  })
})

describe('isApprovalPrompting', function () {
  const pending = {
    approvalID: 'a',
    step: 2,
    tool: 'memory_write',
    arguments: '{}',
    expiresAt: 1000
  }

  it('没有待审批就不弹', function () {
    expect(isApprovalPrompting(task(), new Set())).toBe(false)
  })

  it('有待审批且未决定才弹', function () {
    expect(isApprovalPrompting(task({ pendingApproval: pending }), new Set())).toBe(true)
  })

  it('决定过的审批号不再弹', function () {
    expect(isApprovalPrompting(task({ pendingApproval: pending }), new Set(['a']))).toBe(false)
  })
})

describe('parseToolArguments', function () {
  it('空串与非法 JSON 回空对象', function () {
    expect(parseToolArguments('')).toEqual({})
    expect(parseToolArguments('not-json')).toEqual({})
    expect(parseToolArguments('[1,2]')).toEqual({})
  })

  it('对象原样解出', function () {
    expect(parseToolArguments('{"query":"退款政策","topK":3}')).toEqual({
      query: '退款政策',
      topK: 3
    })
  })
})
