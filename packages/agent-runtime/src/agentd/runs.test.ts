/**
 * 事件帧判别与游标的单元测试。
 *
 * 游标那几条断言对应真实踩过的坑：`sync` 报的 `lastSeq` 必须允许**回退** ——
 * agentd 重启后 seq 从 0 重新开始，本地游标不回退就会把新一轮的每一条事件
 * （含 `settled`）当成重放旧帧丢掉，界面卡在「思考中」直到超时。
 */

import { describe, expect, it } from 'vitest'

import { createRunCursor, parseRunFrame } from './runs'

describe('parseRunFrame', function () {
  it('sync 帧带出权威游标', function () {
    expect(parseRunFrame({ event: 'sync', data: { lastSeq: 7 } })).toEqual({
      kind: 'sync',
      lastSeq: 7
    })
  })

  it('sync 帧缺字段时给 null，而不是猜一个数', function () {
    expect(parseRunFrame({ event: 'sync', data: {} })).toEqual({ kind: 'sync', lastSeq: null })
  })

  it('update 帧带出 seq 与 SessionUpdate', function () {
    const frame = parseRunFrame({
      event: 'run',
      data: { seq: 3, kind: 'update', payload: { sessionUpdate: 'plan', entries: [] } }
    })
    expect(frame.kind).toBe('update')
    if (frame.kind !== 'update') return
    expect(frame.seq).toBe(3)
    expect(frame.update).toEqual({ sessionUpdate: 'plan', entries: [] })
  })

  it('approval / elicitation / status 各自带出 payload', function () {
    const approval = parseRunFrame({
      event: 'run',
      data: { seq: 4, kind: 'approval', payload: { approval: { requestId: 'r1' } } }
    })
    expect(approval.kind).toBe('approval')

    const elicitation = parseRunFrame({
      event: 'run',
      data: { seq: 5, kind: 'elicitation', payload: { elicitation: { requestId: 'e1' } } }
    })
    expect(elicitation.kind).toBe('elicitation')

    const status = parseRunFrame({
      event: 'run',
      data: { seq: 6, kind: 'status', payload: { phase: 'settled', status: 'ok' } }
    })
    expect(status.kind).toBe('status')
  })

  it('未知 kind 与无关事件一律 ignored：旧客户端不该被新服务端打挂', function () {
    expect(parseRunFrame({ event: 'run', data: { seq: 9, kind: 'heartbeat' } })).toEqual({
      kind: 'ignored'
    })
    expect(parseRunFrame({ event: 'ping', data: {} })).toEqual({ kind: 'ignored' })
  })
})

describe('createRunCursor', function () {
  it('只接受严格递增的 seq（补发与实时尾部会重叠）', function () {
    const cursor = createRunCursor(10)
    expect(cursor.accept(10)).toBe(false)
    expect(cursor.accept(9)).toBe(false)
    expect(cursor.accept(11)).toBe(true)
    expect(cursor.accept(11)).toBe(false)
    expect(cursor.read()).toBe(11)
  })

  it('sync 允许把游标往回拨（agentd 重启后 seq 从 0 重来）', function () {
    const cursor = createRunCursor(999)
    expect(cursor.reset(0)).toBe(0)
    expect(cursor.read()).toBe(0)
    // 回退后新一轮的第 1 条事件必须被接受，否则界面永远停在「思考中」
    expect(cursor.accept(1)).toBe(true)
  })
})
