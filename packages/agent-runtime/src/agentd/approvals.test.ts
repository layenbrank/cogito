/**
 * 审批票据与回执的单元测试。
 *
 * 票据那几条是「点了审批没反应 / 报已失效」的根因所在：票据不在表里时要如实返回
 * `null`（调用方据此提示已失效），派生选项时也只认 `*_once`（`*_always` 会写进
 * goose 的 permission.yaml，变成永久偏好）。
 */

import { describe, expect, it } from 'vitest'

import { createApprovalLedger, postApproval, postElicitation } from './approvals'
import type { AgentdTransport } from './transport'

const TICKET = {
  threadID: 'thread-1',
  requestId: 'req-1',
  options: ['allow_always', 'allow_once', 'reject_once', 'reject_always']
}

function fakeTransport(calls: Array<{ path: string; init?: RequestInit }>): AgentdTransport {
  return {
    async call(path: string, init?: RequestInit) {
      calls.push({ path, init })
      return new Response(null, { status: 200 })
    },
    async findEndpoint() {
      throw new Error('测试不该用到 findEndpoint')
    },
    async callJson() {
      throw new Error('测试不该用到 callJson')
    },
    forget() {},
    findCachedEndpoint() {
      return null
    },
    async invokeGoose() {
      throw new Error('测试不该用到 invokeGoose')
    }
  }
}

describe('createApprovalLedger', function () {
  it('未拍板时是 pending，拍板后保留结果', function () {
    const ledger = createApprovalLedger()
    expect(ledger.findState('tc-1')).toBeNull()
    ledger.remember('tc-1', TICKET)
    expect(ledger.findState('tc-1')).toBe('pending')
    ledger.take('tc-1', { approved: true })
    expect(ledger.findState('tc-1')).toBe(true)
  })

  it('没给 optionId 时按 allow / reject 派生，且只认 *_once', function () {
    const ledger = createApprovalLedger()
    ledger.remember('tc-1', TICKET)
    expect(ledger.take('tc-1', { approved: true })?.optionId).toBe('allow_once')

    ledger.remember('tc-2', TICKET)
    expect(ledger.take('tc-2', { approved: false })?.optionId).toBe('reject_once')
  })

  it('显式 optionId 优先于派生', function () {
    const ledger = createApprovalLedger()
    ledger.remember('tc-1', TICKET)
    expect(ledger.take('tc-1', { approved: true, optionId: 'allow_always' })?.optionId).toBe(
      'allow_always'
    )
  })

  it('票据不存在时返回 null（调用方据此提示已失效，而不是假报成功）', function () {
    const ledger = createApprovalLedger()
    expect(ledger.take('nope', { approved: true })).toBeNull()
    expect(ledger.findState('nope')).toBeNull()
  })

  it('票据取走后不能重复消费', function () {
    const ledger = createApprovalLedger()
    ledger.remember('tc-1', TICKET)
    expect(ledger.take('tc-1', { approved: true })).not.toBeNull()
    expect(ledger.take('tc-1', { approved: true })).toBeNull()
  })
})

describe('回执投递', function () {
  it('postApproval 打到该线程的 approvals 路由', async function () {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    const ok = await postApproval(fakeTransport(calls), 'thread-1', 'req-1', 'allow_once')
    expect(ok).toBe(true)
    expect(calls[0]?.path).toBe('/threads/thread-1/approvals/req-1')
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ optionId: 'allow_once' }))
  })

  it('取消走 `{ cancelled: true }` 而不是造一个 optionId', async function () {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    await postApproval(fakeTransport(calls), 'thread-1', 'req-1', null)
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ cancelled: true }))
  })

  it('postElicitation 原样透传 decision', async function () {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    await postElicitation(fakeTransport(calls), 'thread-1', 'e-1', {
      action: 'accept',
      content: { answer: 'x' }
    })
    expect(calls[0]?.path).toBe('/threads/thread-1/elicitations/e-1')
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ action: 'accept', content: { answer: 'x' } }))
  })
})
