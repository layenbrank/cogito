/**
 * 「当前活跃会话」这个信号的唯一来源。
 *
 * 为什么单独抽出来：会话相关的偏好有两份 —— 执行模式（`mode.ts`）和审批档
 * （`approval.ts`）—— 它们都必须**跟着会话切换刷新 UI**。以前只有 mode 有订阅，
 * 切会话时审批开关还显示上一个会话的档位，用户看到的就是「切换会话后审批没重置」。
 *
 * 两份偏好监听同一路信号：多通知一次无害，少通知一次就会看到过期状态。
 */
type ScopeListener = () => void

const listeners = new Set<ScopeListener>()

let activeThreadID: string | null = null

function readScopeThread(): string | null {
  return activeThreadID
}

function subscribeScope(listener: ScopeListener): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

function notifyScope() {
  for (const listener of [...listeners]) listener()
}

/** 由 runtime 在切会话时调用；同值不重复通知 */
function writeScopeThread(threadID: string | null): void {
  if (activeThreadID === threadID) return
  activeThreadID = threadID
  notifyScope()
}

export { notifyScope, readScopeThread, subscribeScope, writeScopeThread }
