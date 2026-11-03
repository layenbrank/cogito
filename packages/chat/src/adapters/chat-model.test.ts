import type { ChatModelRunResult } from '@assistant-ui/react'
import { describe, expect, it } from 'vitest'

import { mapChatStreamToRunResults } from './chat-model'
import type { ChatStreamEvent } from '../ports'

async function* events(list: ChatStreamEvent[]): AsyncGenerator<ChatStreamEvent> {
  for (const event of list) yield event
}

describe('mapChatStreamToRunResults timing', function () {
  it('emits metadata.timing on finish with chunk/tool/token counts', async function () {
    const stream = events([
      { kind: 'text', blockID: 'a', text: 'hello' },
      { kind: 'text', blockID: 'a', text: ' world' },
      { kind: 'tool-call', toolCallId: 't1', toolName: 'read', input: {} },
      { kind: 'tool-result', toolCallId: 't1', toolName: 'read', output: {}, isError: false },
      { kind: 'finish', finishReason: 'end_turn', usage: { totalTokens: 42 } }
    ])

    let last: ChatModelRunResult | undefined
    for await (const result of mapChatStreamToRunResults(stream)) {
      last = result
    }

    expect(last?.metadata?.timing).toBeDefined()
    expect(last?.metadata?.timing?.totalChunks).toBe(2)
    expect(last?.metadata?.timing?.toolCallCount).toBe(1)
    expect(last?.metadata?.timing?.tokenCount).toBe(42)
  })

  it('emits timing on aborted without tokenCount', async function () {
    const stream = events([
      { kind: 'text', blockID: 'a', text: 'x' },
      { kind: 'aborted' }
    ])

    let last: ChatModelRunResult | undefined
    for await (const result of mapChatStreamToRunResults(stream)) {
      last = result
    }

    expect(last?.metadata?.timing).toBeDefined()
    expect(last?.metadata?.timing?.totalChunks).toBe(1)
    expect(last?.metadata?.timing?.tokenCount).toBeUndefined()
  })

  it('marks incomplete when the stream ends without a terminal event', async function () {
    const stream = events([{ kind: 'text', blockID: 'a', text: 'cut' }])

    let last: ChatModelRunResult | undefined
    for await (const result of mapChatStreamToRunResults(stream)) {
      last = result
    }

    expect(last?.status).toEqual({
      type: 'incomplete',
      reason: 'error',
      error: '流异常结束：未收到终态（输出可能不完整）'
    })
  })

  it('marks cancelled when stream ends without terminal but abortSignal already aborted', async function () {
    const stream = events([{ kind: 'text', blockID: 'a', text: 'cut' }])
    const cancel = new AbortController()
    cancel.abort({ name: 'AbortError', detach: true })

    let last: ChatModelRunResult | undefined
    for await (const result of mapChatStreamToRunResults(stream, cancel.signal)) {
      last = result
    }

    expect(last?.status).toEqual({ type: 'incomplete', reason: 'cancelled' })
  })
})
