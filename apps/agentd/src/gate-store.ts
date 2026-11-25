/**
 * 审批 / 追问请求的持久化（`gate_requests`）。
 *
 * 真相仍在进程内的 waiter 里（回执要写回 ACP 管道，跨进程无法接管），持久化解决三件事：
 * 1. 重启后能看出「上一进程留下的 pending 全部作废」，并在启动时统一标成 cancelled；
 * 2. 结案是**幂等**的：重复回执不会改第二次；
 * 3. 审计/排查能看到一条票据从请求到结案的时间线。
 *
 * 进程重启不会「恢复」旧 pending：goose 随 agentd 一起重启，旧会话已经不存在。
 */

import type { AgentdDb } from './db'

type GateKind = 'approval' | 'elicitation'
type GateState = 'pending' | 'settled' | 'expired' | 'cancelled'

interface GateInsert {
  requestId: string
  kind: GateKind
  threadID: string
  sessionId: string
  payload: unknown
  createdAt: number
  expiresAt: number
}

interface GateStore {
  insert: (input: GateInsert) => void
  /** 只允许 pending → 目标状态；返回是否真的改了（重复 settle 返回 false） */
  settle: (requestId: string, state: Exclude<GateState, 'pending'>, decision?: string | null) => boolean
  /** 进程启动时调用：上一进程残留的 pending 一律作废 */
  cancelPending: () => number
  countPending: () => number
}

function createGateStore(db: AgentdDb): GateStore {
  return {
    insert: function (input: GateInsert): void {
      db.run(
        `INSERT OR REPLACE INTO gate_requests
           (request_id, kind, thread_id, session_id, payload, state, decision, created_at, expires_at, settled_at)
         VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL)`,
        input.requestId,
        input.kind,
        input.threadID,
        input.sessionId,
        JSON.stringify(input.payload),
        input.createdAt,
        input.expiresAt
      )
    },
    settle: function (requestId, state, decision): boolean {
      const changed = db.runChanges(
        `UPDATE gate_requests
            SET state = ?, decision = ?, settled_at = ?
          WHERE request_id = ? AND state = 'pending'`,
        state,
        decision ?? null,
        Date.now(),
        requestId
      )
      return changed > 0
    },
    cancelPending: function (): number {
      return db.runChanges(
        `UPDATE gate_requests
            SET state = 'cancelled', settled_at = ?
          WHERE state = 'pending'`,
        Date.now()
      )
    },
    countPending: function (): number {
      const row = db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM gate_requests WHERE state = 'pending'"
      )
      return Number(row?.n ?? 0)
    }
  }
}

export { createGateStore }
export type { GateInsert, GateKind, GateState, GateStore }
