import { describe, expect, it } from 'vitest'

import { compareSessions, latestTime, orderSessions, toTime } from './session-order'

function ids(sessions: Array<{ id: string }>): string[] {
  return sessions.map(function (session) {
    return session.id
  })
}

describe('orderSessions', function () {
  it('puts drafts above pinned sessions', function () {
    const ordered = orderSessions([
      { id: 'pinned', pinned: true, updatedAt: 900 },
      { id: 'draft', draft: true },
      { id: 'recent', updatedAt: 1000 }
    ])
    expect(ids(ordered)).toEqual(['draft', 'pinned', 'recent'])
  })

  it('puts pinned above recent even when the recent one is newer', function () {
    const ordered = orderSessions([
      { id: 'recent', updatedAt: 5_000 },
      { id: 'pinned', pinned: true, updatedAt: 1_000 }
    ])
    expect(ids(ordered)).toEqual(['pinned', 'recent'])
  })

  it('orders by last activity, newest first', function () {
    const ordered = orderSessions([
      { id: 'old', updatedAt: 1_000 },
      { id: 'newest', updatedAt: 3_000 },
      { id: 'middle', updatedAt: 2_000 }
    ])
    expect(ids(ordered)).toEqual(['newest', 'middle', 'old'])
  })

  it('keeps draft insertion order instead of the random draft id', function () {
    const ordered = orderSessions([
      { id: 'zzz-newest-draft', draft: true, order: 0 },
      { id: 'aaa-older-draft', draft: true, order: 1 }
    ])
    expect(ids(ordered)).toEqual(['zzz-newest-draft', 'aaa-older-draft'])
  })

  it('treats missing and invalid timestamps as "no activity" instead of NaN', function () {
    const ordered = orderSessions([
      { id: 'never', updatedAt: null },
      { id: 'invalid', updatedAt: Number.NaN },
      { id: 'active', updatedAt: 1 }
    ])
    expect(ids(ordered)).toEqual(['active', 'invalid', 'never'])
  })

  it('falls back to id so equal timestamps never flip between refreshes', function () {
    const input = [
      { id: 'b', updatedAt: 1_000 },
      { id: 'c', updatedAt: 1_000 },
      { id: 'a', updatedAt: 1_000 }
    ]
    expect(ids(orderSessions(input))).toEqual(['a', 'b', 'c'])
    expect(ids(orderSessions(input.toReversed()))).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input array', function () {
    const input = [
      { id: 'old', updatedAt: 1 },
      { id: 'new', updatedAt: 2 }
    ]
    const snapshot = input.slice()
    orderSessions(input)
    expect(input).toEqual(snapshot)
  })
})

describe('latestTime', function () {
  it('takes the fresher source and normalizes invalid dates', function () {
    expect(latestTime(1_000, 2_000)).toBe(2_000)
    expect(latestTime(Number.NaN, 1_000)).toBe(1_000)
    expect(latestTime(null, undefined)).toBe(0)
  })
})

describe('toTime', function () {
  it('only accepts finite numbers', function () {
    expect(toTime(0)).toBe(0)
    expect(toTime(Number.POSITIVE_INFINITY)).toBe(0)
    expect(toTime(Number.NaN)).toBe(0)
    expect(toTime(undefined)).toBe(0)
  })
})

describe('compareSessions', function () {
  it('is a total order (never returns NaN)', function () {
    const pairs = [
      [{ id: 'a', updatedAt: Number.NaN }, { id: 'b', updatedAt: 0 }],
      [{ id: 'a', draft: true }, { id: 'b', pinned: true }],
      [{ id: 'a' }, { id: 'a' }]
    ] as const
    for (const [a, b] of pairs) {
      const forward = compareSessions(a, b)
      const backward = compareSessions(b, a)
      expect(Number.isNaN(forward)).toBe(false)
      expect(Number.isNaN(backward)).toBe(false)
      // 相等时两边都是 0（`Math.sign` 会给 -0，用 `===` 判等而不是 `Object.is`）
      expect(Math.sign(forward) + 0).toBe(backward === 0 ? 0 : -Math.sign(backward))
    }
  })
})
