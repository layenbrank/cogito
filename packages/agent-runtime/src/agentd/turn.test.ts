/**
 * run 状态机的单元测试（fake transport）。
 *
 * 每条用例都对应一个**真实踩过或审查确认**的缺陷：
 * - 注入与帧抢同一循环时不能丢帧（F-008）；
 * - 空闲上限要参与 race，而不是只在两次 await 之间检查（F-009）；
 * - `sync` 带 pending 审批、`epoch` 变化、`seq` 重叠都要按同一口径处理（F-003 / F-005）；
 * - 终态唯一，且取消/失败也要落游标（F-012）。
 */

import { describe, expect, it } from 'vitest'

import { createApprovalLedger, createElicitationRegistry } from './approvals'
import type { AgentdCaller } from './approvals'
import { TurnFailure, pumpTurn, runTurn } from './turn'
import type { TurnGates, TurnItem } from './turn'

interface FakeSse {
  response: Response
  send: (event: string, data: unknown) => void
  close: () => void
}

function fakeSse(): FakeSse {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start: function (value) {
      controller = value
    }
  })
  const encoder = new TextEncoder()
  return {
    response: new Response(stream, { status: 200 }),
    send: function (event: string, data: unknown) {
      controller?.enqueue(
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      )
    },
    close: function () {
      controller?.close()
    }
  }
}

interface RecordedCall {
  path: string
  body?: unknown
}

function fakeCaller(response: Response, calls: RecordedCall[] = []): AgentdCaller {
  return {
    call: async function (path: string, init?: RequestInit) {
      calls.push({
        path,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
      })
      // 订阅路径带查询串（`?after=` / `&epoch=`），不能靠 endsWith 判断
      if (path.includes('/events')) return response
      return new Response(null, { status: 202 })
    }
  }
}

function makeGates(
  caller: AgentdCaller,
  options: {
    policy?: TurnGates['policy']
    ledger?: TurnGates['ledger']
    settled?: string[]
  } = {}
): TurnGates {
  return {
    transport: caller,
    ledger: options.ledger ?? createApprovalLedger(),
    elicitations: createElicitationRegistry(),
    policy:
      options.policy ??
      function () {
        return { kind: 'ask' as const }
      },
    onSettleError: function (channel, requestId) {
      options.settled?.push(`${channel}:${requestId}`)
    }
  }
}

const TICKET = {
  requestId: 'req-1',
  threadID: 't1',
  sessionId: 's1',
  toolCall: { toolCallId: 'tc-1', name: 'shell' },
  options: [
    { optionId: 'allow_once', name: '允许一次', kind: 'allow_once' },
    { optionId: 'reject_once', name: '拒绝一次', kind: 'reject_once' }
  ]
}

async function collect(iterator: AsyncGenerator<TurnItem>): Promise<TurnItem[]> {
  const items: TurnItem[] = []
  for await (const item of iterator) items.push(item)
  return items
}

/** 给流与微任务一次处理机会（跨来源的先后顺序不靠它断言，只用来避开「尚未开始读」） */
function tick(ms = 5): Promise<void> {
  return new Promise<void>(function (resolve) {
    setTimeout(resolve, ms)
  })
}

describe('pumpTurn · sync 与审批', function () {
  it('sync 的 pending 审批走同一套策略：ask 时推卡并登记票据', async function () {
    const sse = fakeSse()
    const ledger = createApprovalLedger()
    const calls: RecordedCall[] = []
    const pump = pumpTurn({
      threadID: 't1',
      after: 0,
      gates: makeGates(fakeCaller(sse.response, calls), { ledger }),
      signal: new AbortController().signal
    })

    const first = pump.next()
    sse.send('sync', { epoch: 'E1', lastSeq: 0, approvals: [TICKET] })
    sse.send('run', { seq: 1, kind: 'status', payload: { phase: 'settled', status: 'ok' } })

    const firstValue = await first
    expect(firstValue.value).toMatchObject({ kind: 'approval' })
    expect(ledger.findState('tc-1')).toBe('pending')

    const rest = await collect(pump)
    expect(rest).toEqual([{ kind: 'stop', stopReason: 'end_turn' }])
    // ask 不自动回执
    expect(calls.some(function (call) {
      return call.path.includes('/approvals/')
    })).toBe(false)
  })

  it('自动放行档：立刻回执 allow_once，且不推卡', async function () {
    const sse = fakeSse()
    const ledger = createApprovalLedger()
    const calls: RecordedCall[] = []
    const pump = pumpTurn({
      threadID: 't1',
      after: 0,
      gates: makeGates(fakeCaller(sse.response, calls), {
        ledger,
        policy: function () {
          return { kind: 'allow', optionId: 'allow_once' }
        }
      }),
      signal: new AbortController().signal
    })

    const items = collect(pump)
    sse.send('sync', { epoch: 'E1', lastSeq: 0, approvals: [TICKET] })
    sse.send('run', { seq: 1, kind: 'status', payload: { phase: 'settled', status: 'ok' } })

    expect(await items).toEqual([{ kind: 'stop', stopReason: 'end_turn' }])
    const posted = calls.find(function (call) {
      return call.path.includes('/approvals/req-1')
    })
    expect(posted?.body).toEqual({ optionId: 'allow_once' })
    expect(ledger.findState('tc-1')).toBe(true)
  })

  it('没有 reject_once 时按取消结案（fail-closed），绝不退化成放行', async function () {
    const sse = fakeSse()
    const calls: RecordedCall[] = []
    const ticket = {
      ...TICKET,
      options: [{ optionId: 'allow_always', name: '总是允许', kind: 'allow_always' }]
    }
    const pump = pumpTurn({
      threadID: 't1',
      after: 0,
      gates: makeGates(fakeCaller(sse.response, calls), {
        policy: function () {
          return { kind: 'cancel', reason: 'test' }
        }
      }),
      signal: new AbortController().signal
    })

    const items = collect(pump)
    sse.send('sync', { epoch: 'E1', lastSeq: 0, approvals: [ticket] })
    sse.send('run', { seq: 1, kind: 'status', payload: { phase: 'settled', status: 'ok' } })
    await items

    const posted = calls.find(function (call) {
      return call.path.includes('/approvals/req-1')
    })
    expect(posted?.body).toEqual({ cancelled: true })
  })

  it('approval_settled 广播只更新账本、发一次事件（另一客户端不再回执）', async function () {
    const sse = fakeSse()
    const ledger = createApprovalLedger()
    ledger.remember('tc-9', { threadID: 't1', requestId: 'req-9', options: ['allow_once'] })
    const pump = pumpTurn({
      threadID: 't1',
      after: 0,
      gates: makeGates(fakeCaller(sse.response), { ledger }),
      signal: new AbortController().signal
    })

    const items = collect(pump)
    sse.send('run', {
      seq: 1,
      kind: 'approval_settled',
      payload: { approval: { ...TICKET, requestId: 'req-9', toolCall: { toolCallId: 'tc-9' } }, optionId: 'allow_once' }
    })
    sse.send('run', { seq: 2, kind: 'status', payload: { phase: 'settled', status: 'ok' } })

    expect(await items).toEqual([
      { kind: 'approval_settled', toolCallId: 'tc-9', approved: true },
      { kind: 'stop', stopReason: 'end_turn' }
    ])
  })
})

describe('pumpTurn · 游标', function () {
  it('重叠的 seq 只应用一次，且 sync 允许回退游标', async function () {
    const sse = fakeSse()
    const updates: number[] = []
    const pump = pumpTurn({
      threadID: 't1',
      after: 999,
      gates: makeGates(fakeCaller(sse.response)),
      signal: new AbortController().signal,
      onProgress: function (cursor) {
        updates.push(cursor.lastSeq)
      }
    })

    const items = collect(pump)
    // agentd 重启：seq 从 1 重新开始，本地游标还是 999
    sse.send('sync', { epoch: 'E2', lastSeq: 1 })
    sse.send('run', { seq: 2, kind: 'update', payload: { sessionUpdate: 'agent_message_chunk' } })
    sse.send('run', { seq: 2, kind: 'update', payload: { sessionUpdate: 'agent_message_chunk' } })
    sse.send('run', { seq: 3, kind: 'status', payload: { phase: 'settled', status: 'ok' } })

    const collected = await items
    expect(collected.filter(function (item) {
      return item.kind === 'update'
    })).toHaveLength(1)
    expect(updates).toEqual([1, 2, 3])
    expect(collected.at(-1)).toEqual({ kind: 'stop', stopReason: 'end_turn' })
  })

  it('终态必落游标，且带回 sync 里的 epoch', async function () {
    const sse = fakeSse()
    const cursors: Array<{ lastSeq: number; epoch: string | null }> = []
    const pump = pumpTurn({
      threadID: 't1',
      after: 0,
      gates: makeGates(fakeCaller(sse.response)),
      signal: new AbortController().signal,
      onCursor: function (cursor) {
        cursors.push(cursor)
      }
    })

    const items = collect(pump)
    sse.send('sync', { epoch: 'E7', lastSeq: 4 })
    sse.send('run', { seq: 5, kind: 'status', payload: { phase: 'settled', status: 'ok' } })
    await items

    expect(cursors).toEqual([{ lastSeq: 5, epoch: 'E7' }])
  })

  it('truncated 通过 onSync 透出（正文重建留给宿主）', async function () {
    const sse = fakeSse()
    const syncs: boolean[] = []
    const pump = pumpTurn({
      threadID: 't1',
      after: 1,
      gates: makeGates(fakeCaller(sse.response)),
      signal: new AbortController().signal,
      onSync: function (info) {
        syncs.push(info.truncated)
      }
    })

    const items = collect(pump)
    sse.send('sync', { epoch: 'E1', lastSeq: 9, minSeq: 5, truncated: true })
    sse.send('run', { seq: 10, kind: 'status', payload: { phase: 'settled', status: 'ok' } })
    await items

    expect(syncs).toEqual([true])
  })
})

describe('pumpTurn · 不丢帧与超时', function () {
  it('注入胜出后，紧接着的 SSE 帧不丢（F-008）', async function () {
    const sse = fakeSse()
    const injectRef: { current: ((item: TurnItem) => void) | null } = { current: null }
    const pump = pumpTurn({
      threadID: 't1',
      after: 0,
      gates: makeGates(fakeCaller(sse.response)),
      signal: new AbortController().signal,
      injectRef
    })

    const items = collect(pump)
    // 先塞一条帧，再塞注入，再塞终态：三条都必须出现（跨来源的先后顺序不归协议管，
    // 真正的不变量是「一条都不能丢」）
    sse.send('run', { seq: 1, kind: 'update', payload: { sessionUpdate: 'agent_message_chunk' } })
    injectRef.current?.({ kind: 'approval_settled', toolCallId: 'tc-1', approved: true })
    sse.send('run', { seq: 2, kind: 'update', payload: { sessionUpdate: 'agent_message_chunk' } })
    sse.send('run', { seq: 3, kind: 'status', payload: { phase: 'settled', status: 'ok' } })

    const collected = await items
    const kinds = collected.map(function (item) {
      return item.kind
    })
    expect(kinds.filter(function (kind) {
      return kind === 'update'
    })).toHaveLength(2)
    expect(kinds).toContain('approval_settled')
    expect(kinds.at(-1)).toBe('stop')
  })

  it('空闲超时参与等待：没有 settled 也会结束（F-009）', async function () {
    const sse = fakeSse()
    const pump = pumpTurn({
      threadID: 't1',
      after: 0,
      gates: makeGates(fakeCaller(sse.response)),
      signal: new AbortController().signal,
      idleTimeoutMs: 10
    })

    await expect(collect(pump)).rejects.toThrow(TurnFailure)
    await expect(collect(pumpTurn({
      threadID: 't1',
      after: 0,
      gates: makeGates(fakeCaller(fakeSse().response)),
      signal: new AbortController().signal,
      idleTimeoutMs: 10
    }))).rejects.toMatchObject({ code: 'idle_timeout' })
  })

  it('流提前结束（没 settled）如实报错，不假装说完', async function () {
    const sse = fakeSse()
    const pump = pumpTurn({
      threadID: 't1',
      after: 0,
      gates: makeGates(fakeCaller(sse.response)),
      signal: new AbortController().signal
    })

    const items = collect(pump)
    sse.send('run', { seq: 1, kind: 'update', payload: { sessionUpdate: 'agent_message_chunk' } })
    sse.close()

    await expect(items).rejects.toMatchObject({ code: 'stream_closed' })
  })

  it('status.error 的消息带归因，两端说法一致', async function () {
    const sse = fakeSse()
    const pump = pumpTurn({
      threadID: 't1',
      after: 0,
      gates: makeGates(fakeCaller(sse.response)),
      signal: new AbortController().signal
    })

    const items = collect(pump)
    sse.send('run', {
      seq: 1,
      kind: 'status',
      payload: { phase: 'settled', status: 'error', message: 'Upstream 429', errorKind: 'provider' }
    })

    await expect(items).rejects.toMatchObject({
      code: 'run_failed',
      message: '模型 / 网关：Upstream 429'
    })
  })

  it('取消：产出 cancelled 终态而不是错误，并且照样落游标', async function () {
    const sse = fakeSse()
    const controller = new AbortController()
    const cursors: number[] = []
    const pump = pumpTurn({
      threadID: 't1',
      after: 0,
      gates: makeGates(fakeCaller(sse.response)),
      signal: controller.signal,
      onCursor: function (cursor) {
        cursors.push(cursor.lastSeq)
      }
    })

    const items = collect(pump)
    sse.send('run', { seq: 1, kind: 'update', payload: { sessionUpdate: 'agent_message_chunk' } })
    await tick()
    controller.abort()

    expect(await items).toEqual([
      { kind: 'update', update: { sessionUpdate: 'agent_message_chunk' } },
      { kind: 'stop', stopReason: 'cancelled' }
    ])
    expect(cursors).toEqual([1])
  })
})

describe('runTurn', function () {
  it('先订阅再提交，并按显式参数拼请求体', async function () {
    const sse = fakeSse()
    const calls: RecordedCall[] = []
    const runner = runTurn(
      {
        threadID: 't1',
        prompt: 'hi',
        mode: 'approve',
        cwd: 'C:\\repo',
        systemText: 'sys'
      },
      {
        threadID: 't1',
        after: 3,
        gates: makeGates(fakeCaller(sse.response, calls)),
        signal: new AbortController().signal
      }
    )

    const items = collect(runner)
    sse.send('sync', { epoch: 'E1', lastSeq: 3 })
    sse.send('run', { seq: 4, kind: 'status', payload: { phase: 'settled', status: 'ok' } })
    await items

    expect(calls.map(function (call) {
      return call.path
    })).toEqual(['/threads/t1/events?after=3', '/threads/t1/runs'])
    expect(calls[1]?.body).toEqual({
      input: { prompt: 'hi', mode: 'approve', cwd: 'C:\\repo', systemText: 'sys' }
    })
  })

  it('提交被拒：报 run_rejected 而不是继续空等', async function () {
    const sse = fakeSse()
    const caller: AgentdCaller = {
      call: async function (path: string) {
        if (path.includes('/events')) return sse.response
        return new Response('bad input', { status: 400 })
      }
    }
    const runner = runTurn(
      { threadID: 't1', prompt: 'hi', mode: 'approve' },
      {
        threadID: 't1',
        after: 0,
        gates: makeGates(caller),
        signal: new AbortController().signal
      }
    )

    await expect(collect(runner)).rejects.toMatchObject({ code: 'run_rejected' })
  })

  it('写者租约冲突（409）：单独一条 writer_busy，不跟「参数不对」混在一起', async function () {
    const sse = fakeSse()
    const caller: AgentdCaller = {
      call: async function (path: string) {
        if (path.includes('/events')) return sse.response
        return new Response('{"error":"writer_lease_held"}', { status: 409 })
      }
    }
    const runner = runTurn(
      { threadID: 't1', prompt: 'hi', mode: 'approve' },
      {
        threadID: 't1',
        after: 0,
        gates: makeGates(caller),
        signal: new AbortController().signal
      }
    )

    await expect(collect(runner)).rejects.toMatchObject({ code: 'writer_busy' })
  })

  it('显式 takeover 会写进请求体', async function () {
    const sse = fakeSse()
    const calls: RecordedCall[] = []
    const runner = runTurn(
      { threadID: 't1', prompt: 'hi', mode: 'approve', takeover: true },
      {
        threadID: 't1',
        after: 0,
        gates: makeGates(fakeCaller(sse.response, calls)),
        signal: new AbortController().signal
      }
    )

    const items = collect(runner)
    sse.send('sync', { epoch: 'E1', lastSeq: 0 })
    sse.send('run', { seq: 1, kind: 'status', payload: { phase: 'settled', status: 'ok' } })
    await items

    expect(calls[1]?.body).toMatchObject({ takeover: true })
  })
})
