import { describe, expect, it } from 'vitest'

import { openDb } from './db'
import { createGateStore } from './gate-store'

describe('gate store', function () {
  it('pending → settled 只成功一次', function () {
    const db = openDb(':memory:')
    try {
      const store = createGateStore(db)
      store.insert({
        requestId: 'r1',
        kind: 'approval',
        threadID: 't1',
        sessionId: 's1',
        payload: { toolCall: null },
        createdAt: 1,
        expiresAt: 2
      })
      expect(store.countPending()).toBe(1)
      expect(store.settle('r1', 'settled', 'allow_once')).toBe(true)
      expect(store.settle('r1', 'settled', 'allow_always')).toBe(false)
      expect(store.countPending()).toBe(0)
    } finally {
      db.close()
    }
  })

  it('启动时把残留 pending 全部作废', function () {
    const db = openDb(':memory:')
    try {
      const store = createGateStore(db)
      store.insert({
        requestId: 'r1',
        kind: 'elicitation',
        threadID: 't1',
        sessionId: 's1',
        payload: {},
        createdAt: 1,
        expiresAt: 2
      })
      expect(store.cancelPending()).toBe(1)
      expect(store.countPending()).toBe(0)
    } finally {
      db.close()
    }
  })
})
