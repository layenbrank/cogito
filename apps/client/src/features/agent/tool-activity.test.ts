import { describe, expect, it } from 'vitest'

import { findToolActivity, isResultRunning } from '@/features/agent/tool-activity'

describe('工具活动状态', function () {
  it('等审批不是完成：requires-action → waiting', function () {
    expect(findToolActivity({ status: { type: 'requires-action', reason: 'tool-calls' } })).toBe(
      'waiting'
    )
    // 有 isError 也不能把「在等人」说成失败
    expect(
      findToolActivity({
        status: { type: 'requires-action', reason: 'tool-calls' },
        isError: false
      })
    ).toBe('waiting')
  })

  it('中断与失败分开：cancelled 不画成绿勾，也不画成红叉', function () {
    expect(findToolActivity({ status: { type: 'incomplete', reason: 'cancelled' } })).toBe(
      'cancelled'
    )
    expect(findToolActivity({ status: { type: 'incomplete', reason: 'error' } })).toBe('failed')
    expect(findToolActivity({ status: { type: 'incomplete', reason: 'length' } })).toBe('failed')
  })

  it('complete + isError → failed', function () {
    expect(
      findToolActivity({ status: { type: 'complete' }, isError: true, result: 'boom' })
    ).toBe('failed')
  })

  it('结果自称还在跑（终端 isRunning / 长任务）→ running，不是 done', function () {
    expect(
      findToolActivity({ status: { type: 'complete' }, result: { isRunning: true } })
    ).toBe('running')
    expect(findToolActivity({ status: { type: 'complete' }, result: { isRunning: false } })).toBe(
      'done'
    )
  })

  it('没有 status 时按 isError / result 兜底：有调用没结果的历史行不画成执行中', function () {
    expect(findToolActivity({})).toBe('cancelled')
    expect(findToolActivity({ isError: true })).toBe('failed')
    expect(findToolActivity({ result: { ok: true } })).toBe('done')
  })

  it('isResultRunning 只认布尔 true', function () {
    expect(isResultRunning({ isRunning: true })).toBe(true)
    expect(isResultRunning({ isRunning: 'true' })).toBe(false)
    expect(isResultRunning('isRunning')).toBe(false)
    expect(isResultRunning(null)).toBe(false)
  })
})
