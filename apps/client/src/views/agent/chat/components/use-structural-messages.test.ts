import type { ThreadMessage } from '@assistant-ui/react'
import { describe, expect, it } from 'vitest'

import { threadStructureKey } from './use-structural-messages'

function message(id: string, content: readonly unknown[]): ThreadMessage {
  return {
    id,
    role: 'assistant',
    content,
    createdAt: new Date(0),
    status: { type: 'complete', reason: 'unknown' }
  } as unknown as ThreadMessage
}

const textPart = function (text: string) {
  return { type: 'text' as const, text }
}

describe('threadStructureKey', function () {
  it('ignores streaming text growth', function () {
    const before = threadStructureKey([message('m1', [textPart('你好')])])
    const after = threadStructureKey([message('m1', [textPart('你好，世界，再多写一点正文')])])
    expect(after).toBe(before)
  })

  it('changes when a message is appended', function () {
    const before = threadStructureKey([message('m1', [textPart('a')])])
    const after = threadStructureKey([message('m1', [textPart('a')]), message('m2', [])])
    expect(after).not.toBe(before)
  })

  it('changes when a new part appears in the same message', function () {
    const before = threadStructureKey([message('m1', [textPart('a')])])
    const after = threadStructureKey([message('m1', [textPart('a'), textPart('b')])])
    expect(after).not.toBe(before)
  })

  it('changes on tool status / result transitions, without serializing results', function () {
    function tool(status: string, result?: unknown) {
      return {
        type: 'tool-call' as const,
        toolCallId: 'call-1',
        toolName: 'read_file',
        args: { path: 'a.ts' },
        argsText: '{}',
        status: { type: status },
        ...(result === undefined ? {} : { result })
      }
    }
    const running = threadStructureKey([message('m1', [tool('running')])])
    const withResult = threadStructureKey([message('m1', [tool('running', { big: 'x'.repeat(10) })])])
    const completed = threadStructureKey([message('m1', [tool('complete', { big: 'x' })])])
    expect(withResult).not.toBe(running)
    expect(completed).not.toBe(withResult)
  })

  it('tracks attachment filenames', function () {
    const before = threadStructureKey([message('m1', [{ type: 'file', filename: 'a.png' }])])
    const after = threadStructureKey([message('m1', [{ type: 'file', filename: 'b.png' }])])
    expect(after).not.toBe(before)
  })

  it('tolerates an empty list', function () {
    expect(threadStructureKey([])).toBe('0')
  })

  it('tracks data part content（计划条目状态变化要进指纹）', function () {
    function plan(status: string) {
      return {
        type: 'data' as const,
        name: 'plan',
        data: { entries: [{ content: 'a', status }] }
      }
    }
    const pending = threadStructureKey([message('m1', [plan('pending')])])
    const running = threadStructureKey([message('m1', [plan('running')])])
    expect(running).not.toBe(pending)
  })

  it('withTextLength：正文长一档才换指纹，不再逐 token 抖动', function () {
    const short = threadStructureKey([message('m1', [textPart('a'.repeat(10))])], {
      withTextLength: true
    })
    const sameBucket = threadStructureKey([message('m1', [textPart('a'.repeat(200))])], {
      withTextLength: true
    })
    const nextBucket = threadStructureKey([message('m1', [textPart('a'.repeat(500))])], {
      withTextLength: true
    })
    expect(sameBucket).toBe(short)
    expect(nextBucket).not.toBe(short)
  })
})
