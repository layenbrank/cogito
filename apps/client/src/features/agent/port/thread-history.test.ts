import { describe, expect, it } from 'vitest'
import type { ThreadMessage } from '@assistant-ui/react'

import { scrubDetachStubs } from '@/features/agent/port/thread-history'

function message(
  id: string,
  role: ThreadMessage['role'],
  status?: ThreadMessage['status']
): { message: ThreadMessage; parentId: string | null } {
  return {
    parentId: role === 'assistant' ? 'user-1' : null,
    message: {
      id,
      role,
      content: role === 'assistant' ? [{ type: 'text', text: '…' }] : [{ type: 'text', text: 'hi' }],
      createdAt: new Date(),
      ...(status ? { status } : { status: { type: 'complete', reason: 'unknown' } }),
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom: {}
      }
    } as ThreadMessage
  }
}

describe('scrubDetachStubs', function () {
  it('strips trailing cancelled / running assistant placeholders', function () {
    const scrubbed = scrubDetachStubs([
      message('user-1', 'user'),
      message('asst-1', 'assistant', { type: 'incomplete', reason: 'cancelled' })
    ])
    expect(scrubbed.map(function (item) {
      return item.message.id
    })).toEqual(['user-1'])
  })

  it('keeps a completed assistant', function () {
    const scrubbed = scrubDetachStubs([
      message('user-1', 'user'),
      message('asst-1', 'assistant', { type: 'complete', reason: 'stop' })
    ])
    expect(scrubbed).toHaveLength(2)
  })
})
