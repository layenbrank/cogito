import { describe, expect, it } from 'vitest'

import { findApprovalStatusIcon, isApprovalRequest, toApprovalState } from './approval-card-state'

describe('toApprovalState', function () {
  it('还没答复就是 request', function () {
    expect(toApprovalState({})).toBe('request')
  })

  it('拒绝了就结束在 denied', function () {
    expect(toApprovalState({ approved: false })).toBe('denied')
  })

  it('取消按拒绝算：这条路不会执行了', function () {
    expect(toApprovalState({ approved: true, cancelled: true, settled: true })).toBe('denied')
  })

  it('答应了但结果还没到 → running（别提前报完成）', function () {
    expect(toApprovalState({ approved: true })).toBe('running')
  })

  it('答应了且结果到了 → done', function () {
    expect(toApprovalState({ approved: true, settled: true })).toBe('done')
  })
})

describe('isApprovalRequest', function () {
  it('只有 request 还在等人答复', function () {
    expect(isApprovalRequest('request')).toBe(true)
    expect(isApprovalRequest('running')).toBe(false)
    expect(isApprovalRequest('done')).toBe(false)
    expect(isApprovalRequest('denied')).toBe(false)
  })
})

describe('findApprovalStatusIcon', function () {
  it('执行中转圈、完成对勾、拒绝打叉', function () {
    expect(findApprovalStatusIcon('running')).toBe('lucide:loader-circle')
    expect(findApprovalStatusIcon('done')).toBe('lucide:check')
    expect(findApprovalStatusIcon('denied')).toBe('lucide:x')
  })
})
