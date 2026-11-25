/**
 * 运行事件的持久化（`run_events`）。
 *
 * ## 为什么事件必须落库
 *
 * 内存环形缓冲只能支撑「短时间断线」：一旦单轮事件超过上限，头部被裁掉，
 * 旧的 `sync.lastSeq` 仍会告诉前端「你已经是最新的」——正文就会静默缺段。
 * 落库之后，补发来自持久日志，`minSeq` 能明确告诉客户端「你要的位置已经被淘汰」。
 *
 * ## epoch 的作用
 *
 * `seq` 是进程内计数器，agentd 重启后从 1 重来。客户端手里的旧 `seq` 不能与新进程
 * 比较大小，所以每条事件都带 `epoch`；连接时服务端报当前 epoch，客户端据此决定是否
 * 丢弃旧游标。
 */

import type { AgentdDb } from './db'
import type { RunEvent } from './events'

/** 与 `events.ts` 的 `RunEvent` 结构兼容（只读所需字段，避免运行时循环依赖） */
interface StoredRunEvent {
  epoch: string
  seq: number
  threadID: string
  kind: RunEvent['kind']
  payload?: unknown
  runID?: string
  createdAt: number
}

interface EventReplay {
  events: StoredRunEvent[]
  /** 该线程在当前 epoch 下仍保留的最小 seq；null = 没有事件 */
  minSeq: number | null
}

interface RunEventStore {
  insert: (event: StoredRunEvent) => void
  replay: (threadID: string, epoch: string, afterSeq?: number) => EventReplay
  minSeq: (threadID: string, epoch: string) => number | null
  clearThread: (threadID: string) => void
  clearAll: () => void
  /** 删除 `createdAt < beforeMs` 的事件；返回删除条数 */
  prune: (beforeMs: number) => number
  count: () => number
}

interface EventRow {
  epoch: string
  seq: number
  kind: string
  payload: string | null
  run_id: string | null
  created_at: number
}

function createRunEventStore(db: AgentdDb): RunEventStore {
  function insert(event: StoredRunEvent): void {
    db.run(
      `INSERT OR REPLACE INTO run_events
         (thread_id, epoch, seq, kind, payload, run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.threadID,
      event.epoch,
      event.seq,
      event.kind,
      event.payload === undefined ? null : JSON.stringify(event.payload),
      event.runID ?? null,
      event.createdAt
    )
  }

  function minSeq(threadID: string, epoch: string): number | null {
    const row = db.get<{ minSeq: number | null }>(
      'SELECT MIN(seq) AS minSeq FROM run_events WHERE thread_id = ? AND epoch = ?',
      threadID,
      epoch
    )
    const value = row?.minSeq
    return typeof value === 'number' ? value : null
  }

  function replay(threadID: string, epoch: string, afterSeq?: number): EventReplay {
    const rows = db.all<EventRow>(
      `SELECT epoch, seq, kind, payload, run_id, created_at
         FROM run_events
        WHERE thread_id = ? AND epoch = ? AND seq > ?
        ORDER BY seq ASC`,
      threadID,
      epoch,
      afterSeq ?? 0
    )
    const events: StoredRunEvent[] = []
    for (const row of rows) {
      let payload: unknown
      if (row.payload !== null) {
        try {
          payload = JSON.parse(row.payload) as unknown
        } catch {
          // 坏行不该让整条补发失败：保留位置，跳过内容（下一次会从 minSeq 之后继续）
          continue
        }
      }
      events.push({
        epoch: row.epoch,
        seq: row.seq,
        threadID,
        kind: row.kind as RunEvent['kind'],
        payload,
        createdAt: row.created_at,
        ...(row.run_id ? { runID: row.run_id } : {})
      })
    }
    return { events, minSeq: minSeq(threadID, epoch) }
  }

  return {
    insert,
    replay,
    minSeq,
    clearThread: function (threadID: string): void {
      db.run('DELETE FROM run_events WHERE thread_id = ?', threadID)
    },
    clearAll: function (): void {
      db.run('DELETE FROM run_events')
    },
    prune: function (beforeMs: number): number {
      return db.runChanges('DELETE FROM run_events WHERE created_at < ?', beforeMs)
    },
    count: function (): number {
      const row = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM run_events')
      return Number(row?.n ?? 0)
    }
  }
}

export { createRunEventStore }
export type { EventReplay, RunEventStore, StoredRunEvent }
