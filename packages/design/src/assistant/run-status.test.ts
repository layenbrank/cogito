import { describe, expect, it } from 'vitest'

import { findRunNote } from './run-status'

const LABELS = {
  completedRun: '已完成',
  stoppedRun: '已停止生成',
  truncatedRun: '输出被截断',
  interruptedRun: '生成被中断'
}

describe('findRunNote', function () {
  it('运行中不标尾注', function () {
    expect(findRunNote({ type: 'running' }, true, LABELS)).toBeNull()
  })

  it('等人审批不标尾注', function () {
    expect(findRunNote({ type: 'requires-action', reason: 'tool-calls' }, true, LABELS)).toBeNull()
  })

  it('正常跑完只在最后一条消息上标', function () {
    const note = findRunNote({ type: 'complete', reason: 'stop' }, true, LABELS)
    expect(note?.tone).toBe('complete')
    expect(note?.text).toBe('已完成')
    expect(findRunNote({ type: 'complete', reason: 'stop' }, false, LABELS)).toBeNull()
  })

  it('用户停止按停止口径', function () {
    const note = findRunNote({ type: 'incomplete', reason: 'cancelled' }, true, LABELS)
    expect(note?.tone).toBe('cancelled')
    expect(note?.text).toBe('已停止生成')
  })

  it('截断区别于停止：历史消息也要标', function () {
    const note = findRunNote({ type: 'incomplete', reason: 'length' }, false, LABELS)
    expect(note?.tone).toBe('truncated')
    expect(note?.text).toBe('输出被截断')
  })

  it('其它原因按中断处理', function () {
    for (const reason of ['content-filter', 'other', 'tool-calls'] as const) {
      expect(findRunNote({ type: 'incomplete', reason }, true, LABELS)?.tone).toBe('interrupted')
    }
  })

  it('错误交给消息错误块，不重复标尾注', function () {
    expect(findRunNote({ type: 'incomplete', reason: 'error' }, true, LABELS)).toBeNull()
  })

  it('没有状态时什么都不标', function () {
    expect(findRunNote(undefined, true, LABELS)).toBeNull()
  })
})
