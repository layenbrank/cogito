import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  bindBackgroundTurnPersister,
  clearBackgroundTurns,
  consumeBackgroundTurn,
  findBackgroundTurn,
  followBackgroundTurn,
  hasRunningBackgroundTurn,
  isDetachAbort,
  isTerminalEvent,
  isUserStopAbort
} from '@/features/agent/acp/background-turn'
import type { ChatStreamEvent } from '@cogito/chat/ports'

function delay(ms: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

afterEach(function () {
  clearBackgroundTurns()
  bindBackgroundTurnPersister(null)
})

describe('isDetachAbort / isUserStopAbort', function () {
  it('recognizes assistant-ui detach AbortError shape', function () {
    const controller = new AbortController()
    controller.abort({ name: 'AbortError', detach: true })
    expect(isDetachAbort(controller.signal)).toBe(true)
    expect(isUserStopAbort(controller.signal)).toBe(false)
  })

  it('treats user cancel as non-detach stop', function () {
    const controller = new AbortController()
    controller.abort({ name: 'AbortError', detach: false })
    expect(isDetachAbort(controller.signal)).toBe(false)
    expect(isUserStopAbort(controller.signal)).toBe(true)
  })

  it('treats bare abort as neither detach nor user stop', function () {
    const controller = new AbortController()
    controller.abort()
    expect(isDetachAbort(controller.signal)).toBe(false)
    expect(isUserStopAbort(controller.signal)).toBe(false)
  })
})

describe('consumeBackgroundTurn', function () {
  it('keeps pumping after UI detach and lets a follower resume', async function () {
    const threadID = 'thread-bg-1'
    const pump: { signal: AbortSignal | null } = { signal: null }

    async function* start(signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
      pump.signal = signal
      yield { kind: 'text', blockID: 't', text: 'hello' }
      await delay(30)
      if (signal.aborted) {
        yield { kind: 'aborted', usage: {} }
        return
      }
      yield { kind: 'text', blockID: 't', text: ' world' }
      yield { kind: 'finish', finishReason: 'end_turn', usage: {} }
    }

    const ui = new AbortController()
    const first: ChatStreamEvent[] = []
    const consumer = (async function () {
      for await (const event of consumeBackgroundTurn(threadID, ui.signal, start)) {
        first.push(event)
        if (event.kind === 'text' && event.text === 'hello') {
          // 模拟离开 Agent：detach 后 UI 停拉（与 chat-model adapter 一致），泵继续
          ui.abort({ name: 'AbortError', detach: true })
          break
        }
      }
    })()

    await consumer
    expect(first).toEqual([{ kind: 'text', blockID: 't', text: 'hello' }])
    expect(pump.signal?.aborted).toBe(false)
    expect(hasRunningBackgroundTurn(threadID)).toBe(true)

    const resumed: ChatStreamEvent[] = []
    for await (const event of followBackgroundTurn(threadID, undefined)) {
      resumed.push(event)
    }

    expect(resumed.map(function (event) {
      return event.kind
    })).toEqual(['text', 'text', 'finish'])
    expect(hasRunningBackgroundTurn(threadID)).toBe(false)
  })

  it('cancels the pump when the user stops (non-detach abort)', async function () {
    const threadID = 'thread-bg-2'
    let sawAbort = false

    async function* start(signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
      yield { kind: 'text', blockID: 't', text: 'a' }
      await delay(80)
      sawAbort = signal.aborted
      yield signal.aborted
        ? { kind: 'aborted', usage: {} }
        : { kind: 'finish', finishReason: 'end_turn', usage: {} }
    }

    const ui = new AbortController()
    const events: ChatStreamEvent[] = []
    const run = (async function () {
      for await (const event of consumeBackgroundTurn(threadID, ui.signal, start)) {
        events.push(event)
        if (event.kind === 'text') ui.abort({ name: 'AbortError', detach: false })
      }
    })()

    await run
    expect(sawAbort).toBe(true)
    expect(events.some(isTerminalEvent)).toBe(true)
  })

  it('does not cancel the pump on bare abort (roundtrip reopen)', async function () {
    const threadID = 'thread-bg-bare'
    const pump: { signal: AbortSignal | null } = { signal: null }

    async function* start(signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
      pump.signal = signal
      yield { kind: 'text', blockID: 't', text: 'partial' }
      await delay(60)
      yield signal.aborted
        ? { kind: 'aborted', usage: {} }
        : { kind: 'finish', finishReason: 'end_turn', usage: {} }
    }

    const ui = new AbortController()
    const first: ChatStreamEvent[] = []
    for await (const event of consumeBackgroundTurn(threadID, ui.signal, start)) {
      first.push(event)
      if (event.kind === 'text') {
        // performRoundtrip 开新轮：abort() 无 reason —— 不得杀泵
        ui.abort()
        break
      }
    }

    expect(first.map(function (event) {
      return event.kind
    })).toEqual(['text'])
    expect(pump.signal?.aborted).toBe(false)
    expect(hasRunningBackgroundTurn(threadID)).toBe(true)

    const resumed: string[] = []
    for await (const event of followBackgroundTurn(threadID, undefined)) {
      resumed.push(event.kind)
    }
    expect(resumed).toEqual(['text', 'finish'])
  })
})

describe('consumeBackgroundTurn robustness', function () {
  it('synthesizes an error terminal when the pump throws', async function () {
    const threadID = 'thread-bg-3'

    async function* start(): AsyncGenerator<ChatStreamEvent> {
      yield { kind: 'text', blockID: 't', text: 'partial' }
      throw new Error('boom')
    }

    const events: ChatStreamEvent[] = []
    for await (const event of consumeBackgroundTurn(threadID, undefined, start)) {
      events.push(event)
    }

    expect(events.map(function (event) {
      return event.kind
    })).toEqual(['text', 'error'])
    expect(hasRunningBackgroundTurn(threadID)).toBe(false)
  })

  it('synthesizes an error terminal when start returns without finish', async function () {
    const threadID = 'thread-bg-no-terminal'

    async function* start(): AsyncGenerator<ChatStreamEvent> {
      yield { kind: 'text', blockID: 't', text: 'cut off' }
      // 故意不发 finish / aborted / error
    }

    const events: ChatStreamEvent[] = []
    for await (const event of consumeBackgroundTurn(threadID, undefined, start)) {
      events.push(event)
    }

    expect(events.map(function (event) {
      return event.kind
    })).toEqual(['text', 'error'])
    expect(events[1]?.kind).toBe('error')
    if (events[1]?.kind === 'error') {
      expect(events[1].message).toContain('未收到终态')
    }
    expect(hasRunningBackgroundTurn(threadID)).toBe(false)
  })

  it('persists an orphan turn when no subscriber receives the terminal', async function () {
    const threadID = 'thread-bg-4'
    const persisted: { events: ChatStreamEvent[] } = { events: [] }
    bindBackgroundTurnPersister(function (turn) {
      persisted.events = [...turn.events]
    })

    async function* start(): AsyncGenerator<ChatStreamEvent> {
      yield { kind: 'text', blockID: 't', text: 'x' }
      yield { kind: 'finish', finishReason: 'end_turn', usage: {} }
    }

    const ui = new AbortController()
    for await (const event of consumeBackgroundTurn(threadID, ui.signal, start)) {
      if (event.kind === 'text') {
        ui.abort({ name: 'AbortError', detach: true })
        break
      }
    }

    // 泵跑完终态 + finally 里的补写是异步的，留一点时间
    await delay(50)
    expect(persisted.events.some(isTerminalEvent)).toBe(true)
  })

  it('aborts the old pump and starts a new one when start differs', async function () {
    const threadID = 'thread-bg-5'
    let startAAborted = false

    async function* startA(signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
      yield { kind: 'text', blockID: 't', text: 'a' }
      await delay(200)
      startAAborted = signal.aborted
      yield signal.aborted
        ? { kind: 'aborted', usage: {} }
        : { kind: 'finish', finishReason: 'end_turn', usage: {} }
    }
    async function* startB(): AsyncGenerator<ChatStreamEvent> {
      yield { kind: 'text', blockID: 't', text: 'b' }
      yield { kind: 'finish', finishReason: 'end_turn', usage: {} }
    }

    const ui = new AbortController()
    for await (const event of consumeBackgroundTurn(threadID, ui.signal, startA)) {
      if (event.kind === 'text') {
        ui.abort({ name: 'AbortError', detach: true })
        break
      }
    }
    expect(hasRunningBackgroundTurn(threadID)).toBe(true)

    const secondEvents: string[] = []
    for await (const event of consumeBackgroundTurn(threadID, undefined, startB)) {
      secondEvents.push(event.kind === 'text' ? `text:${'text' in event ? event.text : ''}` : event.kind)
    }

    expect(startAAborted).toBe(true)
    expect(secondEvents).toEqual(['text:b', 'finish'])
    expect(hasRunningBackgroundTurn(threadID)).toBe(false)
  })

  it('lets a second consumer with the same start replay the running turn', async function () {
    const threadID = 'thread-bg-6'

    async function* start(): AsyncGenerator<ChatStreamEvent> {
      yield { kind: 'text', blockID: 't', text: 'a' }
      await delay(30)
      yield { kind: 'finish', finishReason: 'end_turn', usage: {} }
    }

    const first = new AbortController()
    const firstEvents: string[] = []
    const consumer = (async function () {
      for await (const event of consumeBackgroundTurn(threadID, first.signal, start)) {
        firstEvents.push(event.kind)
        if (event.kind === 'text') {
          first.abort({ name: 'AbortError', detach: true })
          break
        }
      }
    })()
    await consumer
    expect(firstEvents).toEqual(['text'])
    expect(hasRunningBackgroundTurn(threadID)).toBe(true)

    const secondEvents: string[] = []
    for await (const event of consumeBackgroundTurn(threadID, undefined, start)) {
      secondEvents.push(event.kind)
    }

    expect(secondEvents).toEqual(['text', 'finish'])
    expect(hasRunningBackgroundTurn(threadID)).toBe(false)
  })

  it('unbinds the UI cancel when the consumer leaves early', async function () {
    const threadID = 'thread-bg-7'
    const pump: { signal: AbortSignal | null } = { signal: null }

    async function* start(signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
      pump.signal = signal
      yield { kind: 'text', blockID: 't', text: 'a' }
      await delay(40)
      yield signal.aborted
        ? { kind: 'aborted', usage: {} }
        : { kind: 'finish', finishReason: 'end_turn', usage: {} }
    }

    const ui = new AbortController()
    for await (const event of consumeBackgroundTurn(threadID, ui.signal, start)) {
      if (event.kind === 'text') break
    }

    // 消费端已经离开：后续 abort 不该再打到泵上
    ui.abort({ name: 'AbortError', detach: false })
    await delay(80)

    expect(pump.signal?.aborted).toBe(false)
    expect(hasRunningBackgroundTurn(threadID)).toBe(false)
  })

  it('keeps a finished turn for the retention window then forgets it', async function () {
    vi.useFakeTimers()
    try {
      const threadID = 'thread-bg-8'

      async function* start(): AsyncGenerator<ChatStreamEvent> {
        yield { kind: 'finish', finishReason: 'end_turn', usage: {} }
      }

      for await (const _event of consumeBackgroundTurn(threadID, undefined, start)) {
        void _event
      }
      // 泵的 finally 与 forgetTurnLater 都在微任务后，先冲一遍队列
      await vi.advanceTimersByTimeAsync(0)
      expect(findBackgroundTurn(threadID)).not.toBeNull()

      await vi.advanceTimersByTimeAsync(59_000)
      expect(findBackgroundTurn(threadID)).not.toBeNull()

      await vi.advanceTimersByTimeAsync(2_000)
      expect(findBackgroundTurn(threadID)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
