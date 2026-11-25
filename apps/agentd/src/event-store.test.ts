import { describe, expect, it } from 'vitest'

import { openDb } from './db'
import { createRunEventStore } from './event-store'

function makeStore(): { db: ReturnType<typeof openDb>; store: ReturnType<typeof createRunEventStore> } {
  const db = openDb(':memory:')
  return { db, store: createRunEventStore(db) }
}

describe('run event store', function () {
  it('按 epoch + seq 补发，payload 往返', function () {
    const { db, store } = makeStore()
    try {
      store.insert({
        epoch: 'e1',
        seq: 1,
        threadID: 't1',
        kind: 'update',
        payload: { text: 'a' },
        createdAt: 1000
      })
      store.insert({ epoch: 'e1', seq: 3, threadID: 't1', kind: 'status', createdAt: 2000 })

      const all = store.replay('t1', 'e1', 0)
      expect(all.events.map(function (event) { return event.seq })).toEqual([1, 3])
      expect(all.events[0].payload).toEqual({ text: 'a' })
      expect(all.minSeq).toBe(1)

      const tail = store.replay('t1', 'e1', 2)
      expect(tail.events.map(function (event) { return event.seq })).toEqual([3])
    } finally {
      db.close()
    }
  })

  it('不同 epoch 互不可见；线程之间隔离', function () {
    const { db, store } = makeStore()
    try {
      store.insert({ epoch: 'old', seq: 1, threadID: 't1', kind: 'update', createdAt: 1 })
      store.insert({ epoch: 'new', seq: 1, threadID: 't1', kind: 'update', createdAt: 2 })
      store.insert({ epoch: 'new', seq: 2, threadID: 't2', kind: 'update', createdAt: 3 })

      expect(store.replay('t1', 'old', 0).events).toHaveLength(1)
      expect(store.replay('t1', 'new', 0).events).toHaveLength(1)
      expect(store.replay('t2', 'new', 0).events).toHaveLength(1)
      expect(store.minSeq('t1', 'new')).toBe(1)
    } finally {
      db.close()
    }
  })

  it('prune 按时间淘汰；clear 清线程', function () {
    const { db, store } = makeStore()
    try {
      store.insert({ epoch: 'e', seq: 1, threadID: 't1', kind: 'update', createdAt: 1000 })
      store.insert({ epoch: 'e', seq: 2, threadID: 't1', kind: 'update', createdAt: 5000 })
      expect(store.prune(3000)).toBe(1)
      expect(store.replay('t1', 'e', 0).events.map(function (event) { return event.seq })).toEqual([2])
      expect(store.minSeq('t1', 'e')).toBe(2)

      store.clearThread('t1')
      expect(store.replay('t1', 'e', 0).events).toEqual([])
      expect(store.count()).toBe(0)
    } finally {
      db.close()
    }
  })
})
