/**
 * ACP → 共享事件的映射：只钉住容易被写反的两条。
 *
 * 1. `blockID` 由上下文给（缺 `messageId` 时要靠宿主自增），映射层不能自己编；
 * 2. `context.replace` 必须原样带到事件上 —— 补历史（`session/load` 重放）给的是每条消息的
 *    **完整**文本，丢掉这个标记就会让正文翻倍。
 */

import { describe, expect, it } from 'vitest'

import { parseAcpStreamEvent } from './stream'
import type { AcpStreamContext } from './stream'

function context(replace?: boolean): AcpStreamContext {
  return {
    blockID: function (messageId, kind) {
      return `${kind}:${messageId ?? 'anon'}`
    },
    ...(replace === undefined ? {} : { replace })
  }
}

describe('parseAcpStreamEvent', function () {
  it('正文增量：blockID 由上下文决定，不带 replace', function () {
    const event = parseAcpStreamEvent(
      {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm1',
        content: { type: 'text', text: '你好' }
      } as never,
      context()
    )
    expect(event).toEqual({ kind: 'text', blockID: 'text:m1', text: '你好' })
  })

  it('补历史：正文与推理都带 replace（覆盖语义）', function () {
    const text = parseAcpStreamEvent(
      {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm1',
        content: { type: 'text', text: '完整正文' }
      } as never,
      context(true)
    )
    expect(text).toEqual({
      kind: 'text',
      blockID: 'text:m1',
      text: '完整正文',
      replace: true
    })

    const reasoning = parseAcpStreamEvent(
      {
        sessionUpdate: 'agent_thought_chunk',
        messageId: 'm1',
        content: { type: 'text', text: '完整推理' }
      } as never,
      context(true)
    )
    expect(reasoning).toEqual({
      kind: 'reasoning',
      blockID: 'reasoning:m1',
      text: '完整推理',
      replace: true
    })
  })

  it('工具结果只在终态产出事件，中间进度不进流', function () {
    expect(
      parseAcpStreamEvent(
        { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'in_progress' } as never,
        context()
      )
    ).toBeNull()
    expect(
      parseAcpStreamEvent(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 't1',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'ok' } }]
        } as never,
        context()
      )
    ).toMatchObject({ kind: 'tool-result', toolCallId: 't1' })
  })
})
