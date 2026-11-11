import type { ThreadMessage } from '@assistant-ui/react'
import { describe, expect, it } from 'vitest'

import {
  countReasoningTokens,
  estimateContextBreakdown,
  rankMessagesByTokens
} from './context-estimate'

const textPart = function (text: string) {
  return { type: 'text' as const, text }
}

function toolPart(counter: { calls: number }): ThreadMessage['content'][number] {
  return {
    type: 'tool-call',
    toolCallId: 'call-1',
    toolName: 'read_file',
    args: {
      toJSON() {
        counter.calls += 1
        return { path: 'a.ts' }
      }
    },
    status: { type: 'complete' },
    result: 'x'.repeat(400)
  } as unknown as ThreadMessage['content'][number]
}

function message(content: readonly unknown[]): ThreadMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content,
    createdAt: new Date(0),
    status: { type: 'complete', reason: 'unknown' }
  } as unknown as ThreadMessage
}

describe('estimateContextBreakdown', function () {
  it('counts text / attachment characters into their own buckets', function () {
    const breakdown = estimateContextBreakdown({
      systemText: 'abcd',
      messages: [message([textPart('abcdefgh'), { type: 'file', filename: 'a.png' }])]
    })
    expect(breakdown.systemTokens).toBe(1)
    expect(breakdown.historyTokens).toBe(2)
    expect(breakdown.attachmentTokens).toBe(2)
    expect(breakdown.toolTokens).toBe(0)
  })

  it('serializes a tool result only once per part (no per-token re-stringify)', function () {
    const counter = { calls: 0 }
    const part = toolPart(counter)
    const messages = [message([part])]

    estimateContextBreakdown({ messages })
    estimateContextBreakdown({ messages })
    estimateContextBreakdown({ messages })

    expect(counter.calls).toBe(1)
  })

  it('re-measures a replaced part (streamed text keeps growing)', function () {
    const first = estimateContextBreakdown({
      messages: [message([textPart('abcd')])]
    })
    const second = estimateContextBreakdown({
      messages: [message([textPart('abcdefgh')])]
    })
    expect(first.historyTokens).toBe(1)
    expect(second.historyTokens).toBe(2)
  })
})

describe('rankMessagesByTokens', function () {
  function cost(id: string, role: 'user' | 'assistant', content: readonly unknown[]): ThreadMessage {
    return {
      id,
      role,
      content,
      createdAt: new Date(0),
      status: { type: 'complete', reason: 'unknown' }
    } as unknown as ThreadMessage
  }

  it('按估算 token 倒序取前 N，空消息不占位', function () {
    const ranked = rankMessagesByTokens([
      cost('small', 'user', [textPart('abcd')]),
      cost('empty', 'assistant', []),
      cost('big', 'assistant', [textPart('x'.repeat(400))]),
      cost('mid', 'user', [textPart('x'.repeat(40))])
    ])
    expect(ranked.map((item) => item.id)).toEqual(['big', 'mid', 'small'])
    expect(ranked[0].tokens).toBe(100)
  })

  it('默认只取 5 条，limit 可收紧', function () {
    const many = Array.from({ length: 8 }, function (_value, index) {
      return cost('m' + index, 'user', [textPart('x'.repeat((index + 1) * 40))])
    })
    expect(rankMessagesByTokens(many)).toHaveLength(5)
    expect(rankMessagesByTokens(many, 2).map((item) => item.id)).toEqual(['m7', 'm6'])
  })

  it('label 取正文预览，没有正文时退化成工具名', function () {
    const ranked = rankMessagesByTokens([
      cost('t', 'assistant', [toolPart({ calls: 0 })]),
      cost('u', 'user', [textPart('  今天天气  怎么样  ')])
    ])
    const labels = new Map(ranked.map((item) => [item.id, item.label]))
    expect(labels.get('u')).toBe('今天天气 怎么样')
    expect(labels.get('t')).toBe('read_file')
  })
})

describe('countReasoningTokens', function () {
  it('只数 reasoning part：正文与工具结果不算思考', function () {
    const messages = [
      message([
        { type: 'reasoning', text: 'x'.repeat(400) },
        textPart('x'.repeat(4_000)),
        toolPart({ calls: 0 })
      ])
    ]
    // 400 / 4 = 100，正文与工具那一大坨不计入
    expect(countReasoningTokens(messages)).toBe(100)
  })

  it('跨消息累加，不足一个 token 也向上取整', function () {
    const messages = [message([{ type: 'reasoning', text: 'abc' }]), message([{ type: 'reasoning', text: 'abc' }])]
    expect(countReasoningTokens(messages)).toBe(2)
  })

  it('没有思考时是 0', function () {
    expect(countReasoningTokens([])).toBe(0)
    expect(countReasoningTokens([message([textPart('hi')])])).toBe(0)
  })
})
