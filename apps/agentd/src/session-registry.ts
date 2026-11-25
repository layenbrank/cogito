/**
 * thread → goose ACP session 的内存映射。
 *
 * ## 为什么需要它（而不是每次读 checkpoint）
 *
 * `readSessionID` 原来只从图状态（checkpoint）里取 `sessionId`。但首轮在 `session/new`
 * 之后、整轮结束之前，checkpoint 里**还没有**这个值 —— 于是「首轮点停止」拿不到 session，
 * agentd 只 abort 了外层迭代，goose 侧的长工具照跑，UI 却显示已停止。
 *
 * 这里在图拿到 sessionId 的第一时间登记（新建与复用都登记），取消路径优先读内存，
 * 读不到再退回 checkpoint。进程重启后内存为空，但那时也没有活跃轮，「首轮取消」不再适用。
 */

interface SessionRegistry {
  remember: (threadID: string, sessionId: string) => void
  find: (threadID: string) => string | null
  forgetThread: (threadID: string) => void
  forgetSession: (sessionId: string) => void
  clear: () => void
  size: () => number
}

const MAX_ENTRIES = 2_000

function createSessionRegistry(): SessionRegistry {
  /** 插入顺序即淘汰顺序：线程长期不用时被新的挤掉，客户端下一次 run 会重新登记 */
  const byThread = new Map<string, string>()

  function remember(threadID: string, sessionId: string): void {
    if (!threadID || !sessionId) return
    byThread.delete(threadID)
    byThread.set(threadID, sessionId)
    if (byThread.size <= MAX_ENTRIES) return
    const oldest = byThread.keys().next().value
    if (oldest !== undefined) byThread.delete(oldest)
  }

  function find(threadID: string): string | null {
    return byThread.get(threadID) ?? null
  }

  function forgetThread(threadID: string): void {
    byThread.delete(threadID)
  }

  function forgetSession(sessionId: string): void {
    for (const [threadID, value] of byThread) {
      if (value === sessionId) {
        byThread.delete(threadID)
        return
      }
    }
  }

  return {
    remember,
    find,
    forgetThread,
    forgetSession,
    clear: function () {
      byThread.clear()
    },
    size: function () {
      return byThread.size
    }
  }
}

export { MAX_ENTRIES, createSessionRegistry }
export type { SessionRegistry }
